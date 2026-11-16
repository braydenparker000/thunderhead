import sys
from PIL import Image, ImageFilter
import numpy as np
def hf(path):
    x=np.asarray(Image.open(path).convert('RGB')).astype(float); cr=x[...,0]-x[...,1]; cb=x[...,2]-x[...,1]
    def blur(c): return np.asarray(Image.fromarray(np.clip(c+128,0,255).astype('uint8')).filter(ImageFilter.BoxBlur(3))).astype(float)-128
    return round(float(np.sqrt(((cr-blur(cr))**2).mean())),2), round(float(np.sqrt(((cb-blur(cb))**2).mean())),2)
for tag in sys.argv[1:]:
    for n in ['left','centre','right','corner']:
        try: print(tag, n, 'usual', hf(f'{tag}-{n}-usual.png'), 'network', hf(f'{tag}-{n}-net.png'))
        except Exception as e: print(tag, n, e)
