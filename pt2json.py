import json
import os
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
    for fn in ['nca', 'lppn']:
        data = torch.load(f'{folder}/{fn}.pth', map_location='cpu')
        for k, v in data.items():
            if k == "noise_level":
                continue

            v = v.numpy()
            if v.ndim == 4:
                v = v[:,:,0,0]
                if k == 'w1.weight':
                    # interleaved -> concatenated perception components
                    h, p = v.shape
                    if p % 4 == 0:  # pad last dim
                        v = v.reshape(h, p//4, 4).swapaxes(1,2).reshape(h, p)
                    else:
                        if not "dynamic_texture" in folder:
                            raise ValueError(f"Unexpected w1 weight shape {v.shape} in {folder}")
                        # we have a positional encoding (last 2 channels)
                        v_perc = v[:,:-2]
                        v_pos = v[:,-2:]
                        h, p = v_perc.shape
                        v_perc = v_perc.reshape(h, p//4, 4).swapaxes(1,2).reshape(h, p)
                        v = np.concatenate([v_perc, v_pos], axis=1)
            if v.ndim == 5:
                v = v[:,:,0,0,0]
                if k == 'w1.weight':
                    # interleaved -> concatenated perception components
                    h, p = v.shape
                    v = v.reshape(h, p//5, 5).swapaxes(1,2).reshape(h, p)
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
    demo_type = "dynamic_texture_demo"
    for folder in sorted(glob(f'{demo_type}/models/*')):
        name = folder.split('/')[-1]
        print(name)
        models[name] = export_model(folder)
    if len(models) > 0:
        # Combined file (kept for convenience / backup).
        with open(f'{demo_type}/models.json', 'w') as f:
            json.dump(models, f)

        # Per-model files for lazy loading on the web demo, plus a manifest of the
        # available model names so the page knows what exists without downloading.
        out_dir = f'{demo_type}/json_models'
        os.makedirs(out_dir, exist_ok=True)
        for name, model in models.items():
            with open(f'{out_dir}/{name}.json', 'w') as f:
                json.dump(model, f)
        with open(f'{demo_type}/manifest.json', 'w') as f:
            json.dump(sorted(models.keys()), f)

    

