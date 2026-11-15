// node_modules/abslink/src/types.js
var WireValueType = {
  RAW: "RAW",
  PROXY: "PROXY",
  THROW: "THROW",
  HANDLER: "HANDLER"
};
var MessageType = {
  GET: "GET",
  SET: "SET",
  APPLY: "APPLY",
  CONSTRUCT: "CONSTRUCT",
  RELEASE: "RELEASE"
};

// node_modules/abslink/src/abslink.js
var proxyMarker = /* @__PURE__ */ Symbol("Abslink.proxy");
var releaseProxy = /* @__PURE__ */ Symbol("Abslink.releaseProxy");
var finalizer = /* @__PURE__ */ Symbol("Abslink.finalizer");
var throwMarker = /* @__PURE__ */ Symbol("Abslink.thrown");
var isObject = (val) => typeof val === "object" && val !== null || typeof val === "function";
var proxyTransferHandler = {
  canHandle: (val) => isObject(val) && proxyMarker in val,
  serialize(obj, ep) {
    const markerID = obj[proxyMarker];
    expose(obj, ep, markerID);
    return [markerID, []];
  },
  deserialize(markerID, ep) {
    return wrap(ep, markerID);
  }
};
var throwTransferHandler = {
  canHandle: (value) => isObject(value) && throwMarker in value,
  serialize({ value }) {
    let serialized;
    if (value instanceof Error) {
      serialized = {
        isError: true,
        value: {
          message: value.message,
          name: value.name,
          stack: value.stack
        }
      };
    } else {
      serialized = { isError: false, value };
    }
    return [serialized, []];
  },
  deserialize(serialized) {
    if (serialized.isError) {
      throw Object.assign(new Error(serialized.value.message), serialized.value);
    }
    throw serialized.value;
  }
};
var transferHandlers = /* @__PURE__ */ new Map([
  ["proxy", proxyTransferHandler],
  ["throw", throwTransferHandler]
]);
function filterPath(path, obj) {
  let parent = obj;
  const parentPath = path.slice(0, -1);
  for (const segment of parentPath) {
    if (Object.prototype.hasOwnProperty.call(parent, segment)) {
      parent = parent[segment];
    }
  }
  const lastSegment = path[path.length - 1];
  const RawValue = lastSegment ? parent[lastSegment] : parent;
  return { parent, RawValue, lastSegment };
}
function expose(obj, ep, rootMarkerID) {
  ep.on("message", function callback(data) {
    if (!data)
      return;
    const { id, type, path, markerID } = {
      path: [],
      ...data
    };
    if (markerID !== rootMarkerID)
      return;
    const argumentList = (data.argumentList ?? []).map((v) => fromWireValue(v, ep));
    let returnValue;
    try {
      const { parent, RawValue, lastSegment } = filterPath(path, obj);
      switch (type) {
        case MessageType.GET:
          returnValue = RawValue;
          break;
        case MessageType.SET:
          parent[lastSegment] = fromWireValue(data.value, ep);
          returnValue = true;
          break;
        case MessageType.APPLY:
          returnValue = RawValue.apply(parent, argumentList);
          break;
        case MessageType.CONSTRUCT:
          returnValue = new RawValue(...argumentList);
          break;
        case MessageType.RELEASE:
          returnValue = void 0;
          break;
        default:
          return;
      }
    } catch (value) {
      returnValue = { value, [throwMarker]: 0 };
    }
    Promise.resolve(returnValue).catch((value) => {
      return { value, [throwMarker]: 0 };
    }).then((returnValue2) => {
      if (type === MessageType.CONSTRUCT && !(isObject(returnValue2) && throwMarker in returnValue2)) {
        returnValue2 = proxy(returnValue2);
      }
      const [wireValue, transfer] = toWireValue(returnValue2, ep);
      ep.postMessage({ ...wireValue, id, markerID: rootMarkerID }, transfer);
      if (type === MessageType.RELEASE) {
        ep.off("message", callback);
        obj[finalizer]?.();
      }
    }).catch((_) => {
      const [wireValue, transfer] = toWireValue({
        value: new TypeError("Unserializable return value"),
        [throwMarker]: 0
      }, ep);
      ep.postMessage({ ...wireValue, id, markerID: rootMarkerID }, transfer);
    });
  });
  return obj;
}
function wrap(endpoint, rootMarkerID) {
  const pendingListeners = /* @__PURE__ */ new Map();
  endpoint.on("message", (data) => {
    if (!data?.id) {
      return;
    }
    const resolver = pendingListeners.get(data.id);
    if (!resolver) {
      return;
    }
    try {
      resolver(data);
    } finally {
      pendingListeners.delete(data.id);
    }
  });
  return createProxy({ endpoint, pendingListeners, rootMarkerID });
}
function throwIfProxyReleased(isReleased) {
  if (isReleased) {
    throw new Error("Proxy has been released and is not useable");
  }
}
async function releaseEndpoint(epWithPendingListeners) {
  await requestResponseMessage(epWithPendingListeners, { type: MessageType.RELEASE });
}
var proxyCounter = /* @__PURE__ */ new WeakMap();
var proxyFinalizers = "FinalizationRegistry" in globalThis && new FinalizationRegistry((epWithPendingListeners) => {
  const newCount = (proxyCounter.get(epWithPendingListeners) ?? 0) - 1;
  proxyCounter.set(epWithPendingListeners, newCount);
  if (newCount === 0) {
    releaseEndpoint(epWithPendingListeners).finally(() => {
      epWithPendingListeners.pendingListeners.clear();
    });
  }
});
function registerProxy(proxy2, epWithPendingListeners) {
  const newCount = (proxyCounter.get(epWithPendingListeners) ?? 0) + 1;
  proxyCounter.set(epWithPendingListeners, newCount);
  if (proxyFinalizers) {
    proxyFinalizers.register(proxy2, epWithPendingListeners, proxy2);
  }
}
function unregisterProxy(proxy2) {
  if (proxyFinalizers) {
    proxyFinalizers.unregister(proxy2);
  }
}
function createProxy(epWithPendingListeners, path = []) {
  let isProxyReleased = false;
  const propProxyCache = /* @__PURE__ */ new Map();
  const proxy2 = new Proxy(function() {
  }, {
    get(_target, prop) {
      throwIfProxyReleased(isProxyReleased);
      if (prop === releaseProxy) {
        return async () => {
          for (const subProxy of propProxyCache.values()) {
            subProxy[releaseProxy]();
          }
          propProxyCache.clear();
          unregisterProxy(proxy2);
          releaseEndpoint(epWithPendingListeners).finally(() => {
            epWithPendingListeners.pendingListeners.clear();
          });
          isProxyReleased = true;
        };
      }
      if (prop === "then") {
        if (path.length === 0) {
          return { then: () => proxy2 };
        }
        const r = requestResponseMessage(epWithPendingListeners, {
          type: MessageType.GET,
          path: path.map((p) => p.toString())
        }).then((v) => fromWireValue(v, epWithPendingListeners.endpoint));
        return r.then.bind(r);
      }
      const cachedProxy = propProxyCache.get(prop);
      if (cachedProxy) {
        return cachedProxy;
      }
      const propProxy = createProxy(epWithPendingListeners, [...path, prop]);
      propProxyCache.set(prop, propProxy);
      return propProxy;
    },
    set(_target, prop, rawValue) {
      throwIfProxyReleased(isProxyReleased);
      const [value, transfer] = toWireValue(rawValue, epWithPendingListeners.endpoint);
      return requestResponseMessage(epWithPendingListeners, {
        type: MessageType.SET,
        path: [...path, prop].map((p) => p.toString()),
        value
      }, transfer).then((v) => fromWireValue(v, epWithPendingListeners.endpoint));
    },
    apply(_target, _thisArg, rawArgumentList) {
      throwIfProxyReleased(isProxyReleased);
      const last = path[path.length - 1];
      if (last === "bind") {
        return createProxy(epWithPendingListeners, path.slice(0, -1));
      }
      const [argumentList, transfer] = processArguments(rawArgumentList, epWithPendingListeners);
      return requestResponseMessage(epWithPendingListeners, {
        type: MessageType.APPLY,
        path: path.map((p) => p.toString()),
        argumentList
      }, transfer).then((v) => fromWireValue(v, epWithPendingListeners.endpoint));
    },
    construct(_target, rawArgumentList) {
      throwIfProxyReleased(isProxyReleased);
      const [argumentList, transfer] = processArguments(rawArgumentList, epWithPendingListeners);
      return requestResponseMessage(epWithPendingListeners, {
        type: MessageType.CONSTRUCT,
        path: path.map((p) => p.toString()),
        argumentList
      }, transfer).then((v) => fromWireValue(v, epWithPendingListeners.endpoint));
    }
  });
  registerProxy(proxy2, epWithPendingListeners);
  return proxy2;
}
var transferCache = /* @__PURE__ */ new WeakMap();
function processArguments(argumentList, epWithPendingListeners) {
  const wireValues = [];
  const transferables = [];
  for (const argument of argumentList) {
    const [wireValue, transfer] = toWireValue(argument, epWithPendingListeners.endpoint);
    wireValues.push(wireValue);
    transferables.push(...transfer);
  }
  return [wireValues, transferables];
}
function proxy(obj) {
  return Object.assign(obj, { [proxyMarker]: randomId() });
}
function toWireValue(value, ep) {
  for (const [name, handler] of transferHandlers) {
    if (handler.canHandle(value)) {
      const [serializedValue, transfer] = handler.serialize(value, ep);
      return [{
        type: WireValueType.HANDLER,
        name,
        value: serializedValue
      }, transfer];
    }
  }
  return [{
    type: WireValueType.RAW,
    value
  }, transferCache.get(value) ?? []];
}
function fromWireValue(value, ep) {
  switch (value.type) {
    case WireValueType.HANDLER:
      return transferHandlers.get(value.name).deserialize(value.value, ep);
    case WireValueType.RAW:
      return value.value;
  }
}
function requestResponseMessage(ep, msg, transfer = []) {
  return new Promise((resolve) => {
    const id = randomId();
    ep.pendingListeners.set(id, resolve);
    ep.endpoint.postMessage({ id, ...msg, markerID: ep.rootMarkerID }, transfer);
  });
}
var hex = [];
var alphabet = "0123456789abcdef";
for (let i = 0; i < 256; i++) {
  hex[i] = alphabet[i >> 4 & 15] + alphabet[i & 15];
}
var step = 0;
var buffer = "";
function randomId() {
  let i = 0;
  if (!buffer || step + 16 > 256 * 2) {
    for (buffer = "", step = 0; i < 256; ++i) {
      buffer += hex[Math.random() * 256 | 0];
    }
  }
  return buffer.substring(step, ++step + 16);
}

// node_modules/abslink/adapters/w3c.js
function createWrapper(channel, messageable) {
  const listeners = /* @__PURE__ */ new WeakMap();
  channel.start?.();
  messageable.start?.();
  return {
    on(event, listener) {
      const unwrapped = (event2) => listener(event2.data);
      if ("addEventListener" in channel) {
        channel.addEventListener(event, unwrapped);
      } else if ("addListener" in channel) {
        channel.addListener(event, unwrapped);
      } else {
        channel.on(event, unwrapped);
      }
      listeners.set(listener, unwrapped);
    },
    off(event, listener) {
      const unwrapped = listeners.get(listener);
      if ("removeEventListener" in channel) {
        channel.removeEventListener(event, unwrapped);
      } else if ("removeListener" in channel) {
        channel.removeListener(event, unwrapped);
      } else {
        channel.off(event, unwrapped);
      }
      listeners.delete(listener);
    },
    postMessage(message, transfer = []) {
      messageable.postMessage(message, transfer);
    }
  };
}
function expose2(obj, channel = globalThis, messageable = channel) {
  return expose(obj, createWrapper(channel, messageable));
}

// no-remote-fonts.js
async function queryRemoteFonts() {
  return [];
}

// node_modules/jassub/dist/worker/color-conversions.js
var LIBASS_YCBCR_MATRIX = ["BT.601 TV", void 0, void 0, "BT.601 TV", "BT.601 PC", "BT.709 TV", "BT.709 PC", "SMPTE240M TV", "SMPTE240M PC", "FCC TV", "FCC PC"];
var WEB_MATRIX_COEFFICIENTS = {
  bt709: "BT.709",
  bt470bg: "BT.601",
  smpte170m: "BT.601",
  "bt2020-ncl": "BT.2020"
};
var IDENTITY_MATRIX = new Float32Array([
  1,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  1,
  0,
  0,
  0
]);
var COLOR_CONVERSIONS = {
  "BT.601 TV": {
    "BT.709 TV": [1.0864, 0.096546, -0.014106, -0.072349, 0.845052, -0.027694, -0.014051, 0.058402, 1.0418, 0, 0, 0],
    "BT.709 PC": [0.948465, 0.078946, -0.018254, -0.075064, 0.73081, -0.035837, -0.014578, 0.049067, 0.912915, 0.062745, 0.062745, 0.062745],
    "BT.601 PC": [0.872569, -5863e-6, -5863e-6, -0.01151, 0.866922, -0.01151, -2235e-6, -2235e-6, 0.876196, 0.062745, 0.062745, 0.062745],
    "BT.2020 TV": [1.0363, 0.041089, -0.01846, -0.030397, 0.880729, -0.03624, -5903e-6, 0.078182, 1.0547, 0, 0, 0],
    "BT.2020 PC": [0.904456, 0.030232, -0.022078, -0.038211, 0.76215, -0.043344, -7421e-6, 0.066442, 0.924246, 0.062745, 0.062745, 0.062745]
  },
  "BT.601 PC": {
    "BT.709 TV": [1.244521, 0.117679, -8287e-6, -0.067105, 0.977257, -0.01627, -0.013032, 0.069448, 1.188941, -0.073059, -0.073059, -0.073059],
    "BT.709 PC": [1.0864, 0.096546, -0.014106, -0.072349, 0.845052, -0.027694, -0.014051, 0.058402, 1.0418, 0, 0, 0],
    "BT.601 TV": [1.146164, 7771e-6, 7771e-6, 0.015257, 1.153649, 0.015257, 2963e-6, 2963e-6, 1.141356, -0.073059, -0.073059, -0.073059],
    "BT.2020 TV": [1.187488, 0.054547, -0.013243, -0.019347, 1.017872, -0.025999, -3757e-6, 0.091964, 1.203626, -0.073059, -0.073059, -0.073059],
    "BT.2020 PC": [1.0363, 0.041089, -0.01846, -0.030397, 0.880729, -0.03624, -5903e-6, 0.078182, 1.0547, 0, 0, 0]
  },
  "BT.709 TV": {
    "BT.709 PC": [0.874263, -4169e-6, -4169e-6, -0.014024, 0.864408, -0.014024, -1416e-6, -1416e-6, 0.877016, 0.062745, 0.062745, 0.062745],
    "BT.601 TV": [0.9136, -0.10504, 9578e-6, 0.078478, 1.172167, 0.032222, 7922e-6, -0.067127, 0.9582, 0, 0, 0],
    "BT.601 PC": [0.798366, -0.096439, 4245e-6, 0.054914, 1.015645, 0.014281, 5544e-6, -0.060382, 0.840297, 0.062745, 0.062745, 0.062745],
    "BT.2020 TV": [0.9499, -0.054223, -2956e-6, 0.045506, 1.038105, -9944e-6, 4594e-6, 0.016118, 1.0129, 0, 0, 0],
    "BT.2020 PC": [0.830253, -0.0518, -6765e-6, 0.02595, 0.897881, -0.022759, 262e-5, 0.012743, 0.888347, 0.062745, 0.062745, 0.062745]
  },
  "BT.709 PC": {
    "BT.709 TV": [1.143918, 5526e-6, 5526e-6, 0.018589, 1.156981, 0.018589, 1877e-6, 1877e-6, 1.140269, -0.073059, -0.073059, -0.073059],
    "BT.601 TV": [1.045561, -0.114051, 0.016429, 0.107927, 1.352975, 0.05527, 0.010895, -0.07454, 1.092685, -0.073059, -0.073059, -0.073059],
    "BT.601 PC": [0.9136, -0.10504, 9578e-6, 0.078478, 1.172167, 0.032222, 7922e-6, -0.067127, 0.9582, 0, 0, 0],
    "BT.2020 TV": [1.086885, -0.056202, 2161e-6, 0.070392, 1.20036, 7268e-6, 7106e-6, 0.020226, 1.154955, -0.073059, -0.073059, -0.073059],
    "BT.2020 PC": [0.9499, -0.054223, -2956e-6, 0.045506, 1.038105, -9944e-6, 4594e-6, 0.016118, 1.0129, 0, 0, 0]
  },
  "BT.2020 TV": {
    "BT.709 TV": [1.0501, 0.054794, 3602e-6, -0.046071, 0.960743, 9298e-6, -4029e-6, -0.015537, 0.9871, 0, 0, 0],
    "BT.709 PC": [0.91729, 0.042982, -1986e-6, -0.053764, 0.830653, -5127e-6, -4702e-6, -0.014811, 0.865937, 0.062745, 0.062745, 0.062745],
    "BT.601 TV": [0.9637, -0.046316, 0.015276, 0.03338, 1.130366, 0.039424, 292e-5, -0.08405, 0.9453, 0, 0, 0],
    "BT.601 PC": [0.841393, -0.045837, 8268e-6, 0.016028, 0.979655, 0.021338, 1402e-6, -0.074995, 0.829218, 0.062745, 0.062745, 0.062745],
    "BT.2020 PC": [0.87328, -5151e-6, -5151e-6, -0.013294, 0.865137, -0.013294, -1163e-6, -1163e-6, 0.877269, 0.062745, 0.062745, 0.062745]
  },
  "BT.2020 PC": {
    "BT.709 TV": [1.202254, 0.069205, 0.010929, -0.034825, 1.111325, 0.028206, -3046e-6, -0.016146, 1.125249, -0.073059, -0.073059, -0.073059],
    "BT.709 PC": [1.0501, 0.054794, 3602e-6, -0.046071, 0.960743, 9298e-6, -4029e-6, -0.015537, 0.9871, 0, 0, 0],
    "BT.601 TV": [1.103897, -0.045898, 0.024217, 0.055622, 1.304422, 0.062502, 4865e-6, -0.09414, 1.077664, -0.073059, -0.073059, -0.073059],
    "BT.601 PC": [0.9637, -0.046316, 0.015276, 0.03338, 1.130366, 0.039424, 292e-5, -0.08405, 0.9453, 0, 0, 0],
    "BT.2020 TV": [1.145221, 6828e-6, 6828e-6, 0.017622, 1.156015, 0.017622, 1541e-6, 1541e-6, 1.139934, -0.073059, -0.073059, -0.073059]
  },
  "FCC TV": {
    "BT.709 TV": [1.0874, 0.097509, -0.012742, -0.073666, 0.849372, -0.025058, -0.013734, 0.053119, 1.0378, 0, 0, 0],
    "BT.709 PC": [0.949324, 0.079773, -0.017075, -0.076279, 0.734546, -0.033581, -0.014221, 0.044505, 0.909479, 0.062745, 0.062745, 0.062745],
    "BT.601 TV": [1.001, 932e-6, 1348e-6, -843e-6, 1.005025, 2652e-6, -157e-6, -5957e-6, 0.996, 0, 0, 0],
    "BT.601 PC": [0.873427, -5063e-6, -4698e-6, -0.012309, 0.871277, -9239e-6, -2295e-6, -739e-5, 0.872761, 0.062745, 0.062745, 0.062745],
    "BT.2020 TV": [1.0373, 0.042057, -0.01709, -0.031439, 0.885327, -0.03361, -5861e-6, 0.072615, 1.0507, 0, 0, 0],
    "BT.2020 PC": [0.905315, 0.031062, -0.020895, -0.039185, 0.766131, -0.041093, -7306e-6, 0.061631, 0.920811, 0.062745, 0.062745, 0.062745]
  },
  "FCC PC": {
    "BT.709 TV": [1.245686, 0.118801, -6708e-6, -0.068526, 0.982253, -0.013192, -0.012776, 0.063329, 1.184283, -0.073059, -0.073059, -0.073059],
    "BT.709 PC": [1.0874, 0.097509, -0.012742, -0.073666, 0.849372, -0.025058, -0.013734, 0.053119, 1.0378, 0, 0, 0],
    "BT.601 TV": [1.147328, 8859e-6, 9332e-6, 0.014375, 1.159448, 0.018353, 268e-5, -3923e-6, 1.136698, -0.073059, -0.073059, -0.073059],
    "BT.601 PC": [1.001, 932e-6, 1348e-6, -843e-6, 1.005025, 2652e-6, -157e-6, -5957e-6, 0.996, 0, 0, 0],
    "BT.2020 TV": [1.188652, 0.055675, -0.011658, -0.020455, 1.023185, -0.022927, -3814e-6, 0.085524, 1.198968, -0.073059, -0.073059, -0.073059],
    "BT.2020 PC": [1.0373, 0.042057, -0.01709, -0.031439, 0.885327, -0.03361, -5861e-6, 0.072615, 1.0507, 0, 0, 0]
  },
  "SMPTE240M TV": {
    "BT.709 TV": [0.9994, -314e-6, -3437e-6, 534e-6, 0.981134, -0.011363, 66e-6, 0.01918, 1.0148, 0, 0, 0],
    "BT.709 PC": [0.873747, -4432e-6, -7176e-6, -0.013276, 0.848114, -0.023727, -1648e-6, 0.015142, 0.889726, 0.062745, 0.062745, 0.062745],
    "BT.601 TV": [0.913, -0.105114, 6269e-6, 0.077395, 1.150759, 0.020731, 9605e-6, -0.045646, 0.973, 0, 0, 0],
    "BT.601 PC": [0.797851, -0.096492, 135e-5, 0.054241, 0.997118, 4465e-6, 6732e-6, -0.041802, 0.853008, 0.062745, 0.062745, 0.062745],
    "BT.2020 TV": [0.9493, -0.054572, -6432e-6, 0.045102, 1.018308, -0.021268, 5598e-6, 0.036264, 1.0277, 0, 0, 0],
    "BT.2020 PC": [0.829738, -0.052094, -9807e-6, 0.025874, 0.880769, -0.032428, 3211e-6, 0.030149, 0.901058, 0.062745, 0.062745, 0.062745]
  },
  "SMPTE240M PC": {
    "BT.709 TV": [1.14322, 5153e-6, 1598e-6, 0.018827, 1.135135, 5283e-6, 2337e-6, 0.024095, 1.157502, -0.073059, -0.073059, -0.073059],
    "BT.709 PC": [0.9994, -314e-6, -3437e-6, 534e-6, 0.981134, -0.011363, 66e-6, 0.01918, 1.0148, 0, 0, 0],
    "BT.601 TV": [1.044863, -0.114151, 0.012647, 0.106325, 1.328236, 0.041819, 0.013196, -0.049701, 1.109917, -0.073059, -0.073059, -0.073059],
    "BT.601 PC": [0.913, -0.105114, 6269e-6, 0.077395, 1.150759, 0.020731, 9605e-6, -0.045646, 0.973, 0, 0, 0],
    "BT.2020 TV": [1.086186, -0.056614, -1812e-6, 0.069564, 1.177454, -5992e-6, 8633e-6, 0.043544, 1.172188, -0.073059, -0.073059, -0.073059],
    "BT.2020 PC": [0.9493, -0.054572, -6432e-6, 0.045102, 1.018308, -0.021268, 5598e-6, 0.036264, 1.0277, 0, 0, 0]
  }
};

// node_modules/jassub/dist/worker/renderers/canvas-base.js
function findSpot(segments, w, h, width, height, spot) {
  let bestY = height - h + 1;
  const count = segments.length;
  for (let i = 0; i < count; i++) {
    const segment = segments[i];
    const end = segment.x + w;
    if (end > width)
      break;
    if (segment.y >= bestY)
      continue;
    let y = segment.y;
    for (let j = i + 1; j < count; j++) {
      const next = segments[j];
      if (next.x >= end)
        break;
      if (next.y > y) {
        y = next.y;
        if (y >= bestY)
          break;
      }
    }
    if (y < bestY) {
      bestY = y;
      spot.index = i;
      spot.y = y;
    }
  }
  return bestY <= height - h;
}
function addSegment(segments, { index, y }, w, h) {
  const x = segments[index].x;
  const end = x + w;
  const top = y + h;
  let last = index;
  while (last < segments.length && segments[last].x + segments[last].w <= end)
    last++;
  if (last < segments.length && segments[last].x < end) {
    const partial = segments[last];
    partial.w -= end - partial.x;
    partial.x = end;
  }
  segments.splice(index, last - index, { x, y: top, w });
  if (index + 1 < segments.length && segments[index + 1].y === top) {
    segments[index].w += segments[index + 1].w;
    segments.splice(index + 1, 1);
  }
  if (index > 0 && segments[index - 1].y === top) {
    segments[index - 1].w += segments[index].w;
    segments.splice(index, 1);
  }
  return x;
}
var CanvasRendererBase = class {
  canvas;
  _scheduledResize;
  colorMatrix = IDENTITY_MATRIX;
  constructor(canvas) {
    this.canvas = canvas;
  }
  static isSupported(canvas) {
    try {
      return new this(canvas);
    } catch (e) {
    }
  }
  resizeCanvas(width, height) {
    this._scheduledResize = !width || !height || this.canvas.width === width && this.canvas.height === height ? void 0 : { width, height };
  }
  applyScheduledResize() {
    if (!this._scheduledResize)
      return;
    const resize = this._scheduledResize;
    this._scheduledResize = void 0;
    this.canvas.width = resize.width;
    this.canvas.height = resize.height;
    return resize;
  }
  // Skyline bottom-left packing, identical sources are placed once
  // anyPage lets an image go on any page, WebGL1 and the 2D renderer draw page by page, so they only fill the last page to keep the draw order
  packAtlas(items, width, padding = 0, anyPage = false, height = width) {
    const placed = /* @__PURE__ */ new Map();
    const pages = [];
    const spot = { index: 0, y: 0 };
    width += padding;
    height += padding;
    for (const item of items) {
      const { img, sourceKey } = item;
      const cached = sourceKey && placed.get(sourceKey);
      if (cached) {
        item.x = cached.x;
        item.y = cached.y;
        item.layer = cached.layer;
        continue;
      }
      const w = (item.packW ?? img.w) + padding;
      const h = img.h + padding;
      let layer = anyPage ? 0 : Math.max(0, pages.length - 1);
      while (layer < pages.length && !findSpot(pages[layer], w, h, width, height, spot))
        layer++;
      if (layer === pages.length) {
        pages.push([{ x: 0, y: 0, w: width }]);
        if (!anyPage)
          placed.clear();
        spot.index = 0;
        spot.y = 0;
      }
      item.x = addSegment(pages[layer], spot, w, h);
      item.y = spot.y;
      item.layer = layer;
      if (sourceKey)
        placed.set(sourceKey, item);
    }
    return pages.length;
  }
  destroy() {
  }
};

// node_modules/jassub/dist/worker/renderers/2d-renderer.js
var clamp = (v) => v < 0 ? 0 : v > 1 ? 255 : Math.round(v * 255);
var CTX_OPTS = {
  alpha: true,
  desynchronized: true,
  willReadFrequently: false
};
var MIN_PAGE_SIZE = 1024;
var Canvas2DRenderer = class extends CanvasRendererBase {
  ctx;
  bufferCtx;
  bufferCanvas = new OffscreenCanvas(MIN_PAGE_SIZE, MIN_PAGE_SIZE);
  // the pixel value for each mask value of one image
  colorTable = new Uint32Array(256);
  pagePixels = new Uint32Array(MIN_PAGE_SIZE * MIN_PAGE_SIZE);
  pageImageData = new ImageData(new Uint8ClampedArray(this.pagePixels.buffer), MIN_PAGE_SIZE, MIN_PAGE_SIZE);
  constructor(canvas) {
    super(canvas);
    const ctx = canvas.getContext("2d", CTX_OPTS);
    const bufferCtx = this.bufferCanvas.getContext("2d", CTX_OPTS);
    if (!ctx || !bufferCtx)
      throw new Error("Could not get 2D context");
    this.ctx = ctx;
    this.bufferCtx = bufferCtx;
    this.ctx.imageSmoothingEnabled = false;
  }
  // this should be an svg filter which is cheaper, but not supported
  // issues.chromium.org/u/1/issues/40910142
  setColorConversion(matrix) {
    this.colorMatrix = matrix;
  }
  render(images, heap) {
    if (this.applyScheduledResize())
      this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const items = [];
    let maxWidth = 0;
    let maxHeight = 0;
    for (const img of images) {
      items.push({ img, sourceKey: 0, x: 0, y: 0, layer: 0 });
      maxWidth = Math.max(maxWidth, img.w);
      maxHeight = Math.max(maxHeight, img.h);
    }
    const canvas = this.bufferCanvas;
    if (maxWidth > canvas.width || maxHeight > canvas.height) {
      if (maxWidth > canvas.width)
        canvas.width = maxWidth;
      if (maxHeight > canvas.height)
        canvas.height = maxHeight;
      this.pagePixels = new Uint32Array(canvas.width * canvas.height);
      this.pageImageData = new ImageData(new Uint8ClampedArray(this.pagePixels.buffer), canvas.width, canvas.height);
    }
    const { width, height } = canvas;
    const pixels = this.pagePixels;
    const table = this.colorTable;
    const words = self.HEAPU32RAW;
    const m = this.colorMatrix;
    const pageCount = this.packAtlas(items, width, 0, false, height);
    for (let page = 0, start = 0; page < pageCount; page++) {
      let end = start;
      let drawWidth = 0;
      let drawHeight = 0;
      for (; end < items.length && items[end].layer === page; end++) {
        const { img, x, y } = items[end];
        const { w, h, stride } = img;
        const r = (img.color >>> 24 & 255) / 255;
        const g = (img.color >>> 16 & 255) / 255;
        const bl = (img.color >>> 8 & 255) / 255;
        const cr = clamp(m[0] * r + m[3] * g + m[6] * bl + m[9]);
        const cg = clamp(m[1] * r + m[4] * g + m[7] * bl + m[10]);
        const cb = clamp(m[2] * r + m[5] * g + m[8] * bl + m[11]);
        const color = cb << 16 | cg << 8 | cr;
        const alpha = (255 - (img.color & 255)) / 255;
        for (let k = 1; k < 256; k++)
          table[k] = Math.round(alpha * k) << 24 | color;
        const offset = y * width + x;
        for (let row = 0, pos = img.bitmap, out = offset; row < h; row++, pos += stride, out += width) {
          const head = Math.min(-pos & 3, w);
          const tail = head + (w - head & ~3);
          for (let column = 0; column < head; column++)
            pixels[out + column] = table[heap[pos + column]];
          for (let word = pos + head >>> 2, last = pos + tail >>> 2, o = out + head; word < last; word++, o += 4) {
            const value = words[word];
            pixels[o] = table[value & 255];
            pixels[o + 1] = table[value >>> 8 & 255];
            pixels[o + 2] = table[value >>> 16 & 255];
            pixels[o + 3] = table[value >>> 24];
          }
          for (let column = tail; column < w; column++)
            pixels[out + column] = table[heap[pos + column]];
        }
        drawWidth = Math.max(drawWidth, x + w);
        drawHeight = Math.max(drawHeight, y + h);
      }
      this.bufferCtx.putImageData(this.pageImageData, 0, 0, 0, 0, drawWidth, drawHeight);
      for (let i = start; i < end; i++) {
        const { img, x, y } = items[i];
        this.ctx.drawImage(canvas, x, y, img.w, img.h, img.dst_x, img.dst_y, img.w, img.h);
      }
      start = end;
    }
  }
  destroy() {
    this.ctx = this.bufferCtx = this.bufferCanvas = null;
  }
};

// node_modules/jassub/dist/worker/renderers/webgl-base.js
var MAX_ATLAS_SCREENS = 128;
var ATLAS_IDLE_MS = 2e4;
function atlasPosition(x, y, layer) {
  return (layer * 16384 + y) * 16384 + x;
}
var WebGLRendererBase = class extends CanvasRendererBase {
  gl;
  program;
  // Uniform locations
  u_resolution = null;
  u_colorMatrix = null;
  u_colorOffset = null;
  ctrl = new AbortController();
  constructor(canvas) {
    super(canvas);
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.gl = null;
    }, this.ctrl);
    canvas.addEventListener("webglcontextrestored", () => this._initGL(), this.ctrl);
  }
  createProgram(vertexSource, fragmentSource) {
    const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
    const program = this.gl.createProgram();
    if (!program)
      throw new Error("Failed to create program");
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(program);
      this.gl.deleteProgram(program);
      throw new Error("Failed to link program: " + info);
    }
    this.gl.deleteShader(vertexShader);
    this.gl.deleteShader(fragmentShader);
    this.program = program;
  }
  createShader(type, source) {
    const shader = this.gl.createShader(type);
    if (!shader)
      throw new Error("Failed to create shader");
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error("Failed to compile shader: " + info);
    }
    return shader;
  }
  setColorConversion(matrix) {
    this.colorMatrix = matrix;
    if (!this.gl)
      return;
    this.gl.uniformMatrix3fv(this.u_colorMatrix, false, matrix.subarray(0, 9));
    this.gl.uniform3fv(this.u_colorOffset, matrix.subarray(9));
  }
  beginFrame(images) {
    const resize = this.applyScheduledResize();
    if (resize) {
      this.gl.viewport(0, 0, resize.width, resize.height);
      this.gl.uniform2f(this.u_resolution, resize.width, resize.height);
    }
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    if (images.length === 0) {
      this.gl.flush();
      return false;
    }
    return true;
  }
  applyCommonState(textureUniform) {
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
    this.gl.useProgram(this.program);
    this.gl.uniform1i(textureUniform, 0);
    this.setColorConversion(this.colorMatrix);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.uniform2f(this.u_resolution, this.canvas.width, this.canvas.height);
  }
};

// node_modules/jassub/dist/worker/renderers/webgl1-renderer.js
var VERTEX_SHADER = (
  /* glsl */
  `
precision highp float;

// Quad position attribute (0,0), (1,0), (0,1), (1,0), (1,1), (0,1)
attribute vec2 a_quadPos;

uniform vec2 u_resolution;
uniform vec2 u_atlasSize;

// Per-image attributes
attribute vec4 a_destRect;  // x, y, w, h
attribute vec2 a_srcXY;     // atlas x, y
attribute vec4 a_color;     // r, g, b, a

varying highp vec2 v_quadPos;
varying highp vec2 v_srcUV;
varying highp vec2 v_sizeUV;
varying mediump vec4 v_color;

void main() {
  vec2 pixelPos = a_destRect.xy + a_quadPos * a_destRect.zw;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_quadPos = a_quadPos;
  v_srcUV = a_srcXY / u_atlasSize;
  v_sizeUV = a_destRect.zw / u_atlasSize;
  v_color = a_color;
}
`
);
var FRAGMENT_SHADER = (
  /* glsl */
  `
#ifdef GL_FRAGMENT_PRECISION_HIGH
#define PRECISION highp
#else
#define PRECISION mediump
#endif

precision PRECISION float;

uniform sampler2D u_tex;
uniform mat3 u_colorMatrix;
uniform vec3 u_colorOffset;

varying PRECISION vec2 v_quadPos;
varying PRECISION vec2 v_srcUV;
varying PRECISION vec2 v_sizeUV;
varying mediump vec4 v_color;

void main() {
  // The alpha channel contains the mask.
  float mask = texture2D(u_tex, v_srcUV + v_quadPos * v_sizeUV).a;

  // Convert to the color space of the video (identity if no conversion needed)
  vec3 correctedColor = clamp(u_colorMatrix * v_color.rgb + u_colorOffset, 0.0, 1.0);

  // libass color alpha: 0 = opaque, 255 = transparent (inverted)
  float colorAlpha = 1.0 - v_color.a;

  // Final alpha = colorAlpha * mask
  float a = colorAlpha * mask;

  // Premultiplied alpha output
  gl_FragColor = vec4(correctedColor * a, a);
}
`
);
var INITIAL_INSTANCES = 256;
var ATLAS_ROUND = 64;
var MAX_ATLAS_PAGES = 64;
var MAX_ATLAS_BYTES = 256 * 1024 * 1024;
var IMAGE_FLOATS = 10;
var IMAGE_BYTES = IMAGE_FLOATS * 4;
var VERTEX_FLOATS = IMAGE_FLOATS + 2;
var VERTEX_BYTES = VERTEX_FLOATS * 4;
var QUAD_POSITIONS = new Float32Array([
  0,
  0,
  1,
  0,
  0,
  1,
  1,
  0,
  1,
  1,
  0,
  1
]);
var WebGL1Renderer = class extends WebGLRendererBase {
  maxAtlasSize = 0;
  atlasPadding = 0;
  // Extensions
  instancedArraysExt = null;
  // Uniform locations
  u_tex = null;
  u_atlasSize = null;
  // Attribute locations
  a_quadPos = -1;
  a_destRect = -1;
  a_srcXY = -1;
  a_color = -1;
  // Quad vertex buffer for the instanced path
  quadPosBuffer;
  // Per-image records for the instanced path, or expanded vertices for the
  // non-instanced path. Only one layout is used at a time.
  instanceBuffer;
  instanceData = new Float32Array(0);
  instanceCapacity = 0;
  instanceStride = 0;
  atlasPages = [];
  // The last time a frame used every atlas page.
  atlasFullAt = 0;
  atlasSize = 0;
  maxTextureSize = 0;
  // source key to the position its pixels have in the atlas, see atlasPosition()
  uploadCache = /* @__PURE__ */ new Map();
  // A reusable copy buffer for bitmap uploads
  copyData = new Uint8Array(0);
  constructor(canvas) {
    super(canvas);
    try {
      this._initGL();
    } catch (e) {
      this.destroy();
      throw e;
    }
  }
  _initGL() {
    const gl = this.canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
      stencil: false,
      desynchronized: true,
      powerPreference: "default"
    });
    if (!gl) {
      throw new Error("Could not get WebGL context");
    }
    this.gl = gl;
    const highp = !!gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision;
    this.atlasPages = [];
    this.atlasSize = 0;
    this.uploadCache.clear();
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.instancedArraysExt = this.gl.getExtension("ANGLE_instanced_arrays");
    this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    const mediumpBits = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT)?.precision ?? 10;
    this.maxAtlasSize = highp ? Math.min(this.maxTextureSize, Math.floor(Math.sqrt(MAX_ATLAS_BYTES / MAX_ATLAS_PAGES))) : Math.min(this.maxTextureSize, 2 ** Math.max(6, mediumpBits - 1));
    this.atlasPadding = highp ? 0 : 1;
    this.u_resolution = this.gl.getUniformLocation(this.program, "u_resolution");
    this.u_tex = this.gl.getUniformLocation(this.program, "u_tex");
    this.u_colorMatrix = this.gl.getUniformLocation(this.program, "u_colorMatrix");
    this.u_colorOffset = this.gl.getUniformLocation(this.program, "u_colorOffset");
    this.u_atlasSize = this.gl.getUniformLocation(this.program, "u_atlasSize");
    this.a_quadPos = this.gl.getAttribLocation(this.program, "a_quadPos");
    this.a_destRect = this.gl.getAttribLocation(this.program, "a_destRect");
    this.a_srcXY = this.gl.getAttribLocation(this.program, "a_srcXY");
    this.a_color = this.gl.getAttribLocation(this.program, "a_color");
    this.quadPosBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadPosBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, QUAD_POSITIONS, this.gl.STATIC_DRAW);
    this.instanceBuffer = this.gl.createBuffer();
    this.instanceCapacity = 0;
    const stride = this.instancedArraysExt ? IMAGE_FLOATS : 6 * VERTEX_FLOATS;
    this.ensureInstanceCapacity(INITIAL_INSTANCES, stride);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
    if (this.instancedArraysExt) {
      this.vertexAttrib(this.a_destRect, 4, IMAGE_BYTES, 0, 1);
      this.vertexAttrib(this.a_srcXY, 2, IMAGE_BYTES, 16, 1);
      this.vertexAttrib(this.a_color, 4, IMAGE_BYTES, 24, 1);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadPosBuffer);
      this.vertexAttrib(this.a_quadPos, 2, 0, 0);
    } else {
      this.vertexAttrib(this.a_quadPos, 2, VERTEX_BYTES, 0);
      this.vertexAttrib(this.a_destRect, 4, VERTEX_BYTES, 8);
      this.vertexAttrib(this.a_srcXY, 2, VERTEX_BYTES, 24);
      this.vertexAttrib(this.a_color, 4, VERTEX_BYTES, 32);
    }
    this.applyCommonState(this.u_tex);
    this.gl.uniform2f(this.u_atlasSize, 1, 1);
  }
  vertexAttrib(location, size, stride, offset, divisor = 0) {
    this.gl.enableVertexAttribArray(location);
    this.gl.vertexAttribPointer(location, size, this.gl.FLOAT, false, stride, offset);
    if (divisor)
      this.instancedArraysExt?.vertexAttribDivisorANGLE(location, divisor);
  }
  ensureInstanceCapacity(count, stride) {
    if (count <= this.instanceCapacity)
      return;
    this.instanceCapacity = Math.max(count, this.instanceCapacity * 2, INITIAL_INSTANCES);
    this.instanceStride = stride;
    this.instanceData = new Float32Array(this.instanceCapacity * stride);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceData.byteLength, this.gl.DYNAMIC_DRAW);
  }
  writeImage(offset, img, x, y) {
    const data = this.instanceData;
    data[offset] = img.dst_x;
    data[offset + 1] = img.dst_y;
    data[offset + 2] = img.w;
    data[offset + 3] = img.h;
    data[offset + 4] = x;
    data[offset + 5] = y;
    data[offset + 6] = (img.color >>> 24 & 255) / 255;
    data[offset + 7] = (img.color >>> 16 & 255) / 255;
    data[offset + 8] = (img.color >>> 8 & 255) / 255;
    data[offset + 9] = (img.color & 255) / 255;
  }
  createAtlasPage(size) {
    const texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.ALPHA, size, size, 0, this.gl.ALPHA, this.gl.UNSIGNED_BYTE, null);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    return texture;
  }
  ensureAtlas(size, pages) {
    if (this.atlasSize !== size) {
      for (const page of this.atlasPages)
        this.gl.deleteTexture(page);
      this.atlasPages = [];
      this.atlasSize = size;
      this.uploadCache.clear();
    }
    while (this.atlasPages.length < pages) {
      this.atlasPages.push(this.createAtlasPage(size));
    }
    const now = performance.now();
    if (pages === this.atlasPages.length) {
      this.atlasFullAt = now;
    } else if (now - this.atlasFullAt > ATLAS_IDLE_MS) {
      for (const page of this.atlasPages.splice(pages))
        this.gl.deleteTexture(page);
    }
  }
  render(images, heap) {
    if (!this.gl || !this.beginFrame(images))
      return;
    const items = [];
    let maxDimension = 0;
    let totalArea = 0;
    for (const img of images) {
      if (img.w > this.maxTextureSize || img.h > this.maxTextureSize)
        continue;
      const uploadStrided = img.stride >= img.w && img.stride <= this.maxTextureSize && img.bitmap + img.stride * img.h <= heap.length;
      const packW = uploadStrided ? img.stride : img.w;
      items.push({
        img,
        packW,
        uploadStrided,
        x: 0,
        y: 0,
        layer: 0,
        sourceKey: img.cache_id && `${img.cache_id}:${img.bitmap}:${img.w}:${img.h}:${img.stride}`
      });
      maxDimension = Math.max(maxDimension, packW, img.h);
      totalArea += packW * img.h;
    }
    if (items.length === 0) {
      this.gl.flush();
      return;
    }
    const requestedSize = Math.max(ATLAS_ROUND, Math.ceil(Math.max(maxDimension, Math.ceil(Math.sqrt(totalArea))) / ATLAS_ROUND) * ATLAS_ROUND);
    let size = Math.min(this.maxTextureSize, Math.max(this.atlasSize, requestedSize), Math.max(this.maxAtlasSize, maxDimension));
    let pageCount = this.packAtlas(items, size, this.atlasPadding);
    if (pageCount > MAX_ATLAS_PAGES && size < this.maxAtlasSize) {
      size = this.maxAtlasSize;
      pageCount = this.packAtlas(items, size, this.atlasPadding);
    }
    const maxBytes = MAX_ATLAS_SCREENS * this.canvas.width * this.canvas.height;
    if (pageCount > MAX_ATLAS_PAGES || pageCount > 1 && size * size * pageCount > maxBytes) {
      console.warn("JASSUB: frame exceeds WebGL1 atlas capacity");
      this.gl.flush();
      return;
    }
    this.gl.finish();
    this.ensureAtlas(size, pageCount);
    this.ensureInstanceCapacity(items.length, this.instanceStride);
    const oldCache = this.uploadCache;
    this.uploadCache = /* @__PURE__ */ new Map();
    const pageItems = Array.from({ length: pageCount }, () => []);
    for (const item of items)
      pageItems[item.layer].push(item);
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const page = pageItems[pageIndex];
      if (!page.length)
        continue;
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.atlasPages[pageIndex]);
      for (const { img, x, y, layer, sourceKey, packW, uploadStrided } of page) {
        if (sourceKey) {
          const position = atlasPosition(x, y, layer);
          const cached = oldCache.get(sourceKey) === position || this.uploadCache.get(sourceKey) === position;
          this.uploadCache.set(sourceKey, position);
          if (cached)
            continue;
        }
        if (uploadStrided) {
          this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, x, y, packW, img.h, this.gl.ALPHA, this.gl.UNSIGNED_BYTE, heap.subarray(img.bitmap, img.bitmap + img.stride * img.h));
        } else {
          const length = img.w * img.h;
          if (length > this.copyData.length)
            this.copyData = new Uint8Array(length);
          const sourceView = heap.subarray(img.bitmap, img.bitmap + img.stride * img.h);
          for (let y2 = 0; y2 < img.h; y2++) {
            const srcOffset = y2 * img.stride;
            this.copyData.set(sourceView.subarray(srcOffset, srcOffset + img.w), y2 * img.w);
          }
          this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, x, y, img.w, img.h, this.gl.ALPHA, this.gl.UNSIGNED_BYTE, this.copyData.subarray(0, length));
        }
      }
    }
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const page = pageItems[pageIndex];
      if (!page.length)
        continue;
      for (let i = 0; i < page.length; i++) {
        const { img, x, y } = page[i];
        if (this.instancedArraysExt) {
          this.writeImage(i * IMAGE_FLOATS, img, x, y);
        } else {
          for (let v = 0; v < 6; v++) {
            const o = (i * 6 + v) * VERTEX_FLOATS;
            this.instanceData[o] = QUAD_POSITIONS[v * 2];
            this.instanceData[o + 1] = QUAD_POSITIONS[v * 2 + 1];
            this.writeImage(o + 2, img, x, y);
          }
        }
      }
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, page.length * this.instanceStride));
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.atlasPages[pageIndex]);
      this.gl.uniform2f(this.u_atlasSize, this.atlasSize, this.atlasSize);
      if (this.instancedArraysExt) {
        this.instancedArraysExt.drawArraysInstancedANGLE(this.gl.TRIANGLES, 0, 6, page.length);
      } else {
        this.gl.drawArrays(this.gl.TRIANGLES, 0, page.length * 6);
      }
    }
    this.gl.flush();
  }
  destroy() {
    this.ctrl.abort();
    if (!this.gl)
      return;
    for (const page of this.atlasPages)
      this.gl.deleteTexture(page);
    this.atlasPages = [];
    this.uploadCache.clear();
    this.gl.deleteBuffer(this.quadPosBuffer);
    this.gl.deleteBuffer(this.instanceBuffer);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.quadPosBuffer = this.instanceBuffer = this.program = this.gl = this.copyData = null;
  }
};

// node_modules/jassub/dist/worker/renderers/webgl2-renderer.js
var VERTEX_SHADER2 = (
  /* glsl */
  `#version 300 es
precision highp float;

const vec2 QUAD_POSITIONS[6] = vec2[6](
  vec2(0.0, 0.0),
  vec2(1.0, 0.0),
  vec2(0.0, 1.0),
  vec2(1.0, 0.0),
  vec2(1.0, 1.0),
  vec2(0.0, 1.0)
);

uniform vec2 u_resolution;

// Instance attributes
in vec4 a_destRect;  // x, y, w, h
in vec2 a_srcXY;     // atlas x, y
in vec4 a_color;     // r, g, b, a
in float a_layer;    // atlas layer

flat out vec2 v_destXY;
flat out vec4 v_color;
flat out vec2 v_texSize;
flat out vec2 v_srcXY;
flat out float v_layer;

void main() {
  vec2 quadPos = QUAD_POSITIONS[gl_VertexID];
  vec2 pixelPos = a_destRect.xy + quadPos * a_destRect.zw;
  vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y;

  gl_Position = vec4(clipPos, 0.0, 1.0);
  v_destXY = a_destRect.xy;
  v_color = a_color;
  v_texSize = a_destRect.zw;
  v_srcXY = a_srcXY;
  v_layer = a_layer;
}
`
);
var FRAGMENT_SHADER2 = (
  /* glsl */
  `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray u_atlas;
uniform mat3 u_colorMatrix;
uniform vec3 u_colorOffset;
uniform vec2 u_resolution;

flat in vec2 v_destXY;
flat in vec4 v_color;
flat in vec2 v_texSize;
flat in vec2 v_srcXY;
flat in float v_layer;

out vec4 fragColor;

void main() {
  // Flip Y: WebGL's gl_FragCoord.y is 0 at bottom, but destXY.y is from top
  vec2 fragPos = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);

  // Calculate local position within the quad (screen coords)
  vec2 localPos = fragPos - v_destXY;

  // Convert to integer texel coordinates for texelFetch
  ivec2 texCoord = ivec2(floor(localPos));

  // Bounds check (prevents out-of-bounds access)
  ivec2 texSizeI = ivec2(v_texSize);
  if (texCoord.x < 0 || texCoord.y < 0 || texCoord.x >= texSizeI.x || texCoord.y >= texSizeI.y) {
    discard;
  }

  // texelFetch: integer coords, no interpolation, no precision issues
  float mask = texelFetch(u_atlas, ivec3(ivec2(v_srcXY) + texCoord, int(v_layer)), 0).r;

  // Convert to the color space of the video (identity if no conversion needed)
  vec3 correctedColor = clamp(u_colorMatrix * v_color.rgb + u_colorOffset, 0.0, 1.0);

  // libass color alpha: 0 = opaque, 255 = transparent (inverted)
  float colorAlpha = 1.0 - v_color.a;

  // Final alpha = colorAlpha * mask
  float a = colorAlpha * mask;

  // Premultiplied alpha output
  fragColor = vec4(correctedColor * a, a);
}
`
);
var ATLAS_PADDING = 1;
var INITIAL_INSTANCES2 = 256;
var INSTANCE_STRIDE = 32;
var ATLAS_ROUND2 = 64;
var ATLAS_TARGET_LAYERS = 8;
var ATLAS_AREA_SIZE_CAP = 1024;
var WebGL2Renderer = class extends WebGLRendererBase {
  vao;
  u_atlas = null;
  // Interleaved instance buffer: dest rect, atlas position, color, then layer
  instanceBuffer;
  instanceData;
  instanceFloats;
  instanceBytes;
  instanceCapacity = 0;
  atlas = null;
  atlasFullAt = 0;
  maxTextureSize = 0;
  maxArrayTextureLayers = 0;
  // source key to the position its pixels have in the atlas
  uploadCache = /* @__PURE__ */ new Map();
  _createInstanceData() {
    this.instanceData = new ArrayBuffer(this.instanceCapacity * INSTANCE_STRIDE);
    this.instanceFloats = new Float32Array(this.instanceData);
    this.instanceBytes = new Uint8Array(this.instanceData);
  }
  ensureInstanceCapacity(count) {
    if (count <= this.instanceCapacity)
      return;
    this.instanceCapacity = Math.max(count, this.instanceCapacity * 2, INITIAL_INSTANCES2);
    this._createInstanceData();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceCapacity * INSTANCE_STRIDE, this.gl.DYNAMIC_DRAW);
  }
  constructor(canvas) {
    super(canvas);
    try {
      this._initGL();
    } catch (e) {
      this.destroy();
      throw e;
    }
  }
  _initGL() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
      stencil: false,
      desynchronized: true,
      powerPreference: "default"
    });
    if (!gl) {
      throw new Error("Could not get WebGL2 context");
    }
    this.gl = gl;
    this.maxTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
    this.maxArrayTextureLayers = this.gl.getParameter(this.gl.MAX_ARRAY_TEXTURE_LAYERS);
    this.atlas = null;
    this.uploadCache.clear();
    this.createProgram(VERTEX_SHADER2, FRAGMENT_SHADER2);
    this.u_resolution = this.gl.getUniformLocation(this.program, "u_resolution");
    this.u_atlas = this.gl.getUniformLocation(this.program, "u_atlas");
    this.u_colorMatrix = this.gl.getUniformLocation(this.program, "u_colorMatrix");
    this.u_colorOffset = this.gl.getUniformLocation(this.program, "u_colorOffset");
    this.instanceBuffer = this.gl.createBuffer();
    this.instanceCapacity = 0;
    this.ensureInstanceCapacity(INITIAL_INSTANCES2);
    this.vao = this.gl.createVertexArray();
    this.gl.bindVertexArray(this.vao);
    const destRectLoc = this.gl.getAttribLocation(this.program, "a_destRect");
    this.gl.enableVertexAttribArray(destRectLoc);
    this.gl.vertexAttribPointer(destRectLoc, 4, this.gl.FLOAT, false, INSTANCE_STRIDE, 0);
    this.gl.vertexAttribDivisor(destRectLoc, 1);
    const srcXYLoc = this.gl.getAttribLocation(this.program, "a_srcXY");
    this.gl.enableVertexAttribArray(srcXYLoc);
    this.gl.vertexAttribPointer(srcXYLoc, 2, this.gl.FLOAT, false, INSTANCE_STRIDE, 16);
    this.gl.vertexAttribDivisor(srcXYLoc, 1);
    const colorLoc = this.gl.getAttribLocation(this.program, "a_color");
    this.gl.enableVertexAttribArray(colorLoc);
    this.gl.vertexAttribPointer(colorLoc, 4, this.gl.UNSIGNED_BYTE, true, INSTANCE_STRIDE, 24);
    this.gl.vertexAttribDivisor(colorLoc, 1);
    const layerLoc = this.gl.getAttribLocation(this.program, "a_layer");
    this.gl.enableVertexAttribArray(layerLoc);
    this.gl.vertexAttribPointer(layerLoc, 1, this.gl.FLOAT, false, INSTANCE_STRIDE, 28);
    this.gl.vertexAttribDivisor(layerLoc, 1);
    this.applyCommonState(this.u_atlas);
  }
  createAtlasTexture(size, depth) {
    if (this.atlas) {
      this.gl.deleteTexture(this.atlas.texture);
    }
    const texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, texture);
    this.gl.texImage3D(
      this.gl.TEXTURE_2D_ARRAY,
      0,
      this.gl.R8,
      size,
      size,
      depth,
      0,
      this.gl.RED,
      this.gl.UNSIGNED_BYTE,
      null
      // Firefox cries about uninitialized data, but is slower with zero initialized data...
    );
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_MAX_LEVEL, 0);
    this.atlas = { texture, size, depth };
  }
  render(images, heap) {
    if (!this.gl || !this.beginFrame(images))
      return;
    let maxDimension = 0;
    let totalArea = 0;
    const items = [];
    for (const img of images) {
      if (img.w > this.maxTextureSize || img.h > this.maxTextureSize)
        continue;
      items.push({
        img,
        x: 0,
        y: 0,
        layer: 0,
        sourceKey: img.cache_id && `${img.cache_id}:${img.bitmap}:${img.w}:${img.h}:${img.stride}`
      });
      maxDimension = Math.max(maxDimension, img.w, img.h);
      totalArea += img.w * img.h;
    }
    if (items.length === 0) {
      this.gl.flush();
      return;
    }
    const areaSize = Math.min(ATLAS_AREA_SIZE_CAP, Math.sqrt(totalArea / ATLAS_TARGET_LAYERS));
    const initialSize = Math.min(this.maxTextureSize, Math.ceil(Math.max(maxDimension, areaSize) / ATLAS_ROUND2) * ATLAS_ROUND2);
    let size = Math.max(this.atlas?.size ?? 0, initialSize);
    const maxLayers = this.maxArrayTextureLayers || 256;
    const ordered = [...items].sort((a, b) => b.img.h - a.img.h);
    let pageCount = this.packAtlas(ordered, size, ATLAS_PADDING, true);
    while (pageCount > maxLayers && size < this.maxTextureSize) {
      size = Math.min(this.maxTextureSize, size * 2);
      pageCount = this.packAtlas(ordered, size, ATLAS_PADDING, true);
    }
    const maxBytes = MAX_ATLAS_SCREENS * this.canvas.width * this.canvas.height;
    if (pageCount > maxLayers || pageCount > 1 && size * size * pageCount > maxBytes) {
      console.warn("JASSUB: frame exceeds texture array capacity");
      this.gl.flush();
      return;
    }
    this.gl.finish();
    const oldCache = this.uploadCache;
    const now = performance.now();
    const grow = !this.atlas || this.atlas.size < size || this.atlas.depth < pageCount;
    const shrink = !grow && pageCount < this.atlas.depth && now - this.atlasFullAt > ATLAS_IDLE_MS;
    if (grow || shrink) {
      this.createAtlasTexture(size, pageCount);
      oldCache.clear();
    }
    if (pageCount === this.atlas.depth)
      this.atlasFullAt = now;
    this.ensureInstanceCapacity(items.length);
    this.uploadCache = /* @__PURE__ */ new Map();
    let instanceCount = 0;
    for (const { img, x, y, layer, sourceKey } of items) {
      let cached = false;
      if (sourceKey) {
        const position = atlasPosition(x, y, layer);
        cached = oldCache.get(sourceKey) === position || this.uploadCache.get(sourceKey) === position;
        this.uploadCache.set(sourceKey, position);
      }
      if (!cached) {
        this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, img.stride);
        this.gl.texSubImage3D(
          this.gl.TEXTURE_2D_ARRAY,
          0,
          x,
          y,
          layer,
          // x, y, z offset
          img.w,
          img.h,
          1,
          // depth (1 layer)
          this.gl.RED,
          this.gl.UNSIGNED_BYTE,
          heap,
          img.bitmap
        );
      }
      const f = instanceCount * 8;
      this.instanceFloats[f] = img.dst_x;
      this.instanceFloats[f + 1] = img.dst_y;
      this.instanceFloats[f + 2] = img.w;
      this.instanceFloats[f + 3] = img.h;
      this.instanceFloats[f + 4] = x;
      this.instanceFloats[f + 5] = y;
      this.instanceFloats[f + 7] = layer;
      const b = instanceCount * INSTANCE_STRIDE + 24;
      this.instanceBytes[b] = img.color >>> 24 & 255;
      this.instanceBytes[b + 1] = img.color >>> 16 & 255;
      this.instanceBytes[b + 2] = img.color >>> 8 & 255;
      this.instanceBytes[b + 3] = img.color & 255;
      instanceCount++;
    }
    this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, 0);
    if (instanceCount !== 0) {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.instanceBytes, 0, instanceCount * INSTANCE_STRIDE);
      this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, 6, instanceCount);
    }
    this.gl.flush();
  }
  destroy() {
    this.ctrl.abort();
    this.uploadCache.clear();
    if (!this.gl)
      return;
    if (this.atlas)
      this.gl.deleteTexture(this.atlas.texture);
    this.gl.deleteBuffer(this.instanceBuffer);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.instanceBuffer = this.vao = this.program = this.gl = this.atlas = null;
  }
};

// node_modules/jassub/dist/worker/util.js
var WEIGHT_MAP = [
  "thin",
  "extralight",
  "light",
  "regular",
  // Normal isn't used
  "medium",
  "semibold",
  "bold",
  "extrabold",
  "black",
  "ultrablack"
];
async function fetchok(url) {
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`JASSUB: failed to fetch ${url}: HTTP ${res.status}`);
  return res;
}
async function fetchtext(url) {
  const res = await fetchok(url);
  return await res.text();
}
var THREAD_COUNT = self.crossOriginIsolated ? Math.min(Math.max(1, navigator.hardwareConcurrency - 2), 8) : 1;

// node_modules/jassub/dist/worker/worker.js
var __rewriteRelativeImportExtension = function(path, preserveJsx) {
  if (typeof path === "string" && /^\.\.?\//.test(path)) {
    return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function(m, tsx, d, ext, cm) {
      return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";
    });
  }
  return path;
};
var constructor = /* @__PURE__ */ Symbol.for("constructor");
function readImages(view) {
  const images = [];
  for (let i = 0; i < view.length; i += 8) {
    images.push({
      w: view[i],
      h: view[i + 1],
      dst_x: view[i + 2],
      dst_y: view[i + 3],
      // bitmap, color and cache_id are unsigned in C
      bitmap: view[i + 4] >>> 0,
      color: view[i + 5] >>> 0,
      stride: view[i + 6],
      cache_id: view[i + 7] >>> 0
    });
  }
  return images;
}
function renderError(e) {
  if (e instanceof Error)
    return e;
  if (e === "unwind")
    return new Error("JASSUB: a render thread crashed, the WASM heap probably could not grow");
  if (!e)
    return new Error("JASSUB: rendering aborted, the WASM heap probably could not grow");
  return new Error(`JASSUB: rendering failed: ${JSON.stringify(e)}`);
}
var NO_TRACK = "JASSUB: no track is loaded";
var INVALID_TRACK = "JASSUB: libass rejected the subtitle content, it is not a valid SSA/ASS track";
var WEIGHT_SUFFIX = new RegExp(`^(.+)\\s+(${WEIGHT_MAP.join("|")})$`);
var ASSRenderer = class {
  _wasm;
  // undefined: no conversion
  _videoColorSpace;
  _malloc;
  _gpurender;
  debug = false;
  constructor(...args) {
    return this[constructor](...args);
  }
  async [constructor](data, getFont, ctrl) {
    this._availableFonts = Object.fromEntries(Object.entries(data.availableFonts).map(([k, v]) => [k.trim().toLowerCase(), v]));
    this.debug = data.debug;
    this.queryFonts = data.queryFonts;
    this._getFont = getFont;
    this._defaultFont = data.defaultFont.trim().toLowerCase();
    const _fetch = globalThis.fetch;
    globalThis.fetch = (_) => _fetch(data.wasmUrl);
    this._gpurender = WebGL2Renderer.isSupported(ctrl) ?? WebGL1Renderer.isSupported(ctrl) ?? new Canvas2DRenderer(ctrl);
    ctrl.addEventListener("webglcontextrestored", () => {
      if (this._lastDrawTime)
        this._draw(this._lastDrawTime, true);
    });
    this._loadedInitialFonts = !data.fonts.length;
    const { default: WASM } = await import(__rewriteRelativeImportExtension(
      /* @vite-ignore */
      /* webpackIgnore: true */
      data.wasmWorkerUrl
    ));
    const { _malloc, JASSUB } = await WASM({ __url: data.wasmUrl, __workerUrl: data.wasmWorkerUrl, __poolSize: THREAD_COUNT > 1 ? THREAD_COUNT : 0, __out: (log) => this._log(log) });
    globalThis.fetch = _fetch;
    this._malloc = _malloc;
    this._wasm = new JASSUB(data.width, data.height, this._defaultFont);
    this._wasm.setThreads(THREAD_COUNT);
    if (!this._loadedInitialFonts)
      await this._loadInitialFonts(data.fonts);
    if (!this._wasm.createTrackMem(data.subContent ?? await fetchtext(data.subUrl)))
      throw new Error(INVALID_TRACK);
    if (data.libassMemoryLimit > 0 || data.libassGlyphLimit > 0) {
      this._wasm.setMemoryLimits(data.libassGlyphLimit || 0, data.libassMemoryLimit || 0);
    }
    this._checkColorSpace();
    return this;
  }
  // this passes a string of track data to libass, be it styles, events etc, which it then processes and adds to the track
  // useful for streaming subtitles
  processData(events) {
    if (!this._wasm.processData(events))
      throw new Error(NO_TRACK);
  }
  // processes a single subtitle packet with ReadOrder, timecode and duration
  // useful for streaming subtitles from Matroska-style demuxers
  processChunk(data, timecode, duration) {
    if (!this._wasm.processChunk(data, timecode, duration))
      throw new Error(NO_TRACK);
  }
  // removes all events that ended before the deadline, in milliseconds
  pruneEvents(deadline) {
    if (!this._wasm.pruneEvents(deadline))
      throw new Error(NO_TRACK);
  }
  // after every render, libass removes the events that ended more than delay milliseconds ago
  _pruneDelay = -1;
  configurePrune(delay) {
    this._pruneDelay = delay;
    this._wasm.configurePrune(delay);
  }
  // removes all events, but keeps the styles and the script info
  removeAllEvents() {
    if (!this._wasm.removeAllEvents())
      throw new Error(NO_TRACK);
  }
  createEvent(event) {
    if (!this._wasm.createEvent(event))
      throw new Error(NO_TRACK);
  }
  getEvents() {
    return this._wasm.getEvents();
  }
  setEvent(event, index) {
    if (!this._wasm.setEvent(index, event))
      throw new RangeError(`JASSUB: no event at index ${index}`);
  }
  removeEvent(index) {
    if (!this._wasm.removeEvent(index))
      throw new RangeError(`JASSUB: no event at index ${index}`);
  }
  createStyle(style) {
    if (!this._wasm.createStyle(style))
      throw new Error(NO_TRACK);
  }
  getStyles() {
    return this._wasm.getStyles();
  }
  setStyle(style, index) {
    if (!this._wasm.setStyle(index, style))
      throw new RangeError(`JASSUB: no style at index ${index}`);
  }
  removeStyle(index) {
    if (!this._wasm.removeStyle(index))
      throw new RangeError(`JASSUB: no style at index ${index}`);
  }
  styleOverride(style) {
    this._wasm.styleOverride(style);
  }
  disableStyleOverride() {
    this._wasm.disableStyleOverride();
  }
  setTrack(content) {
    if (!this._wasm.createTrackMem(content))
      throw new Error(INVALID_TRACK);
    this._wasm.configurePrune(this._pruneDelay);
    this._checkColorSpace();
  }
  freeTrack() {
    this._wasm.removeTrack();
  }
  async setTrackByUrl(url) {
    this.setTrack(await fetchtext(url));
  }
  _checkColorSpace() {
    const subtitle = LIBASS_YCBCR_MATRIX[this._wasm.trackColorSpace];
    this._gpurender.setColorConversion(new Float32Array((subtitle && this._videoColorSpace && COLOR_CONVERSIONS[subtitle][this._videoColorSpace]) ?? IDENTITY_MATRIX));
    if (this._lastDrawTime)
      this._draw(this._lastDrawTime, true);
  }
  _defaultFont;
  setDefaultFont(fontName) {
    this._defaultFont = fontName.trim().toLowerCase();
    this._wasm.setDefaultFont(this._defaultFont);
  }
  async _log(log) {
    console.debug(log);
    const match = log.match(/JASSUB: fontselect:[^(]+: \(([^,]*), (\d{1,4}), \d+\)/);
    if (match && !await this._findAvailableFont(match[1].trim().toLowerCase(), WEIGHT_MAP[Math.ceil(parseInt(match[2]) / 100) - 1])) {
      await this._findAvailableFont(this._defaultFont);
    }
  }
  async addFonts(fontOrURLs) {
    if (!fontOrURLs.length)
      return false;
    const strings = [];
    const uint8s = [];
    for (const fontOrURL of fontOrURLs) {
      if (typeof fontOrURL === "string") {
        strings.push(fontOrURL);
      } else {
        uint8s.push(fontOrURL);
      }
    }
    if (uint8s.length)
      this._allocFonts(uint8s);
    const results = await Promise.allSettled(strings.map((url) => this._asyncWrite(url)));
    for (const result of results) {
      if (result.status === "rejected")
        console.warn("JASSUB: failed to load font", result.reason);
    }
    return true;
  }
  // we don't want to run _findAvailableFont before initial fonts are loaded
  // because it could duplicate fonts
  _loadedInitialFonts = false;
  async _loadInitialFonts(fontOrURLs) {
    await this.addFonts(fontOrURLs);
    this._loadedInitialFonts = true;
    this._wasm.reloadFonts();
  }
  _getFont;
  _availableFonts = {};
  _checkedFonts = /* @__PURE__ */ new Set();
  async _findAvailableFont(fontName, weight) {
    if (!this._loadedInitialFonts)
      return;
    const match = fontName.match(WEIGHT_SUFFIX);
    if (match) {
      fontName = match[1];
      weight = match[2];
    }
    weight ??= "regular";
    const key = fontName + " " + weight;
    if (this._checkedFonts.has(key))
      return;
    this._checkedFonts.add(key);
    try {
      const font = this._availableFonts[key] ?? this._availableFonts[fontName] ?? await this._queryLocalFont(fontName, weight) ?? await this._queryRemoteFont([key, fontName]);
      if (font)
        return await this.addFonts([font]);
    } catch (e) {
      console.warn("Error querying font", fontName, weight, e);
    }
  }
  queryFonts;
  async _queryLocalFont(fontName, weight) {
    if (!this.queryFonts)
      return;
    return await this._getFont(fontName, weight);
  }
  async _queryRemoteFont(postscriptNames) {
    if (this.queryFonts !== "localandremote")
      return;
    const fontData = await queryRemoteFonts({ postscriptNames });
    if (!fontData.length)
      return;
    const blob = await fontData[0].blob();
    return new Uint8Array(await blob.arrayBuffer());
  }
  async _asyncWrite(font) {
    const res = await fetchok(font);
    this._allocFonts([new Uint8Array(await res.arrayBuffer())]);
  }
  _fontId = 0;
  _allocFonts(uint8s) {
    for (const uint8 of uint8s) {
      const ptr = this._malloc(uint8.byteLength) >>> 0;
      self.HEAPU8RAW.set(uint8, ptr);
      this._wasm.addFont("font-" + this._fontId++, ptr, uint8.byteLength);
    }
    this._wasm.reloadFonts();
  }
  _resizeCanvas(width, height, videoWidth, videoHeight) {
    this._wasm.resizeCanvas(width, height, videoWidth, videoHeight);
    this._gpurender.resizeCanvas(width, height);
  }
  async [finalizer]() {
    this._wasm.quitLibrary();
    this._gpurender.destroy();
    this._wasm = null;
    this._gpurender = null;
    this._availableFonts = {};
  }
  _lastDrawTime;
  _draw(time, repaint = false) {
    this._lastDrawTime = time;
    try {
      const view = this._wasm.rawRender(time, Number(repaint));
      if (!view)
        return;
      this._gpurender.render(readImages(view), self.HEAPU8RAW);
    } catch (e) {
      throw renderError(e);
    }
  }
  // single-frame readback for tests
  _drawCapture(time) {
    const view = this._wasm.rawRender(time, 1);
    this._gpurender.render(view ? readImages(view) : [], self.HEAPU8RAW);
    const canvas = this._gpurender.canvas;
    if (!canvas)
      return;
    const { width, height } = canvas;
    const surface = new OffscreenCanvas(width, height);
    const ctx = surface.getContext("2d");
    if (!ctx)
      return;
    ctx.drawImage(canvas, 0, 0);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  }
  _setColorSpace(matrix, fullRange) {
    this._videoColorSpace = matrix && matrix !== "rgb" ? `${WEB_MATRIX_COEFFICIENTS[matrix]} ${fullRange ? "PC" : "TV"}` : void 0;
    this._checkColorSpace();
  }
};
if (self.name === "jassub-worker") {
  expose2(ASSRenderer);
}
export {
  ASSRenderer
};
