// @ts-check
// How noisy the sensor is: for each ISO, the variance of a recorded value x (0..1 of the sensor's range) is
// a·x + b, for red, green and blue. The numbers are darktable's noise profile for the Fujifilm X-E5 (darktable's
// data/noiseprofiles.json, GPL-3; measured by its contributors). Other X-Trans cameras use the same table: the
// X-T5, X-H2 and X100VI's own differ from it by less than the step between two ISOs.

// ISO, then a for red, green, blue, then b for red, green, blue
const TABLE = [
  [64, 5.977e-6, 2.648e-6, 5.180e-6, 5.476e-9, 2.568e-9, 4.745e-9],
  [80, 7.524e-6, 3.325e-6, 6.499e-6, 7.334e-9, 3.826e-9, 6.792e-9],
  [100, 9.318e-6, 4.103e-6, 8.049e-6, 1.004e-8, 5.660e-9, 9.204e-9],
  [125, 6.018e-6, 2.644e-6, 5.196e-6, 4.757e-9, 2.202e-9, 4.272e-9],
  [160, 7.623e-6, 3.340e-6, 6.564e-6, 6.361e-9, 3.261e-9, 5.821e-9],
  [200, 9.488e-6, 4.158e-6, 8.189e-6, 8.627e-9, 4.756e-9, 7.912e-9],
  [250, 1.185e-5, 5.211e-6, 1.021e-5, 1.181e-8, 6.612e-9, 1.089e-8],
  [320, 1.485e-5, 6.512e-6, 1.280e-5, 1.544e-8, 9.473e-9, 1.442e-8],
  [400, 1.857e-5, 8.151e-6, 1.600e-5, 1.989e-8, 1.228e-8, 1.872e-8],
  [500, 2.329e-5, 1.017e-5, 2.007e-5, 1.926e-8, 1.145e-8, 1.769e-8],
  [640, 2.935e-5, 1.279e-5, 2.524e-5, 2.314e-8, 1.428e-8, 2.178e-8],
  [800, 3.667e-5, 1.596e-5, 3.159e-5, 2.846e-8, 1.765e-8, 2.674e-8],
  [1000, 4.623e-5, 2.014e-5, 3.987e-5, 3.491e-8, 2.207e-8, 3.246e-8],
  [1250, 5.837e-5, 2.545e-5, 5.036e-5, 4.468e-8, 2.895e-8, 4.180e-8],
  [1600, 7.358e-5, 3.199e-5, 6.332e-5, 5.698e-8, 3.846e-8, 5.352e-8],
  [2000, 9.297e-5, 4.048e-5, 8.004e-5, 7.389e-8, 5.090e-8, 6.991e-8],
  [2500, 1.179e-4, 5.137e-5, 1.017e-4, 9.628e-8, 6.807e-8, 9.073e-8],
  [3200, 1.475e-4, 6.426e-5, 1.270e-4, 1.244e-7, 8.983e-8, 1.185e-7],
  [4000, 1.864e-4, 8.151e-5, 1.600e-4, 1.674e-7, 1.244e-7, 1.616e-7],
  [5000, 2.376e-4, 1.040e-4, 2.049e-4, 2.201e-7, 1.734e-7, 2.142e-7],
  [6400, 2.940e-4, 1.293e-4, 2.532e-4, 3.669e-7, 3.243e-7, 3.792e-7],
  [8000, 3.740e-4, 1.657e-4, 3.245e-4, 4.977e-7, 4.656e-7, 5.165e-7],
  [10000, 4.730e-4, 2.102e-4, 4.098e-4, 6.229e-7, 6.528e-7, 6.845e-7],
  [12800, 4.925e-4, 2.204e-4, 4.301e-4, 6.293e-7, 6.787e-7, 6.867e-7],
  [25600, 4.462e-4, 2.008e-4, 3.878e-4, 5.733e-7, 6.250e-7, 6.187e-7],
  [51200, 4.519e-4, 2.017e-4, 3.916e-4, 4.453e-7, 4.949e-7, 4.628e-7],
];

/** The noise at an ISO: a and b for red, green, blue, read between the table's nearest two ISOs.
 * @param {number} iso @returns {{ a: number[], b: number[] }} */
export function noiseAt(iso) {
  const i = Math.max(1, TABLE.findIndex((r) => r[0] >= iso)), hi = TABLE[i === 0 || TABLE[TABLE.length - 1][0] < iso ? TABLE.length - 1 : i], lo = TABLE[Math.max(0, TABLE.indexOf(hi) - 1)];
  const t = hi[0] === lo[0] ? 0 : Math.max(0, Math.min(1, Math.log(iso / lo[0]) / Math.log(hi[0] / lo[0]))), v = lo.map((x, k) => x * (hi[k] / x) ** t);
  return { a: v.slice(1, 4), b: v.slice(4, 7) };
}
