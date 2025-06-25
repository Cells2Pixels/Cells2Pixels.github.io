import json
import base64
from glob import glob
import numpy as np
import torch

def np2json(a):
    a = np.ascontiguousarray(a)
    shape = a.shape
    data = base64.b64encode(a.tobytes()).decode('ascii')
    return dict(shape=shape, dtype=a.dtype.name, data64=data)

def export_model(folder):
    model = {}
    for fn in ['nca', 'siren']:
        data = torch.load(f'{folder}/{fn}.pth', map_location='cpu')
        for k, v in data.items():
            v = v.numpy()
            if v.ndim == 4:
                v = v[:,:,0,0]
            if k == 'w1.weight':
                # interleaved -> concatenated perception components
                h, p = v.shape
                v = v.reshape(h, p//4, 4).swapaxes(1,2).reshape(h, p)
            if k == 'w2.weight':
                # transpose w2 to simplify fused nca update accumulation
                k += '.T'
                v = v.T
            if v.shape[-1] % 4 != 0:  # pad last dim
                pad = 4-v.shape[-1]%4
                v = np.pad(v, [(0,0)]*(v.ndim-1) + [(0,pad)])
            model[f'{fn}.{k}'] = np2json(v)
    return model

if __name__ == '__main__':
    models = {}
    for folder in sorted(glob('2DPBR/*')):
        name = folder.split('/')[-1]
        print(name)
        models[name] = export_model(folder)
    if len(models) > 0:
        with open('data/siren_nca.json', 'w') as f:
            json.dump(models, f)

    

