// TODO
// FIX Brush (click position is not correct)
// 

export function createDemo3DTexture(glsl, divId) {
    const root = document.getElementById(divId);
    const $ = q => root.querySelector(q);
    const $$ = q => root.querySelectorAll(q);

    const canvas = $("#demo-canvas");


    const CHN = 16, C4 = CHN / 4, D4 = 32 / 4, S4 = 1;
    const H = 128, W = 128; // Size of the NCA grid
    let nca_grid, siren_grid;
    let models, model;
    const BLOCK_DIM = [64, 64, 64];
    const BLOCK_VOXELS = BLOCK_DIM[0] * BLOCK_DIM[1] * BLOCK_DIM[2];
    const GRID_HEIGHT = Math.floor(Math.sqrt(BLOCK_VOXELS));
    const GRID_WIDTH = Math.ceil(BLOCK_VOXELS / GRID_HEIGHT);

    const GRID_DIM = [GRID_WIDTH, GRID_HEIGHT];
    let IMAGE_DIM = [128, 128];
    const DEPTH_SAMPLE_DIST = 1.0 / IMAGE_DIM[0];


    const params = {
        models_path: './3d_texture_demo/models.json',
        model: 'bubbly_0101',
        // model: 'Sci-fi_Wall_010',
        runModel: true,
        relativeScale: 2,
        reset_upon_load: true,
        step_n: 1,
        speed: -1,
    };

    const uniforms = {
        viewR: 0.64,
        viewC: [0.5, 0.5],
        brush_size: 1.0,
        brush_mode: 0, // 0: erase, 1: seed
        brush_enabled: true,
        visMode: 0,
        heightScale: 0.15,
        showWireframe: false,
        geom: 0,
        zoom: 0.0,
        background: 1.0,
        samples_per_ray: 64,
    };

    const camera = {
        theta: 25.0,
        phi: 45.0,
        distance: 2.5,
        fov: 60.0,
        znear: 0.3,
        zfar: 10.0,
        aspect: 1.0,
        up: [0, 0, 1],
        look_at: [0, 0, 0],
        focal: null,
    }
    const camera_uniforms = {
        camera_position: null,
        view: null,
    }

    const bg_color = {
        "polka-doted_0121": 1.0,
        "bubbly_0101": 1.0,
        "cobwebbed_0059": 1.0,
        "ink": 1.0,
    }

    let last_cursor_style = 'default';
    let prevPos = [0, 0];
    let currentTarget = null;
    let frame_count = 0;



    function reset_ui() {
        if ($('#reset_on_load').checked == params.reset_upon_load) {
            $('#reset_on_load').checked = !params.reset_upon_load;
        }

        if (params.runModel) {
            $('#play').style.display = "none";
            $('#pause').style.display = "inline";
        } else {
            $('#play').style.display = "inline";
            $('#pause').style.display = "none";
        }

        if (params.speed != $('#speed').value) {
            $('#speed').value = params.speed;
            $('#speedLabel').innerHTML = ['1/8x', '1/4x', '1/2x', '1x', '2x', '4x', '8x'][params.speed + 3];
        }

        if (params.relativeScale != $('#LPPN_scale').value) {
            $('#LPPN_scale').value = params.relativeScale;
            $('#LPPN_scaleLabel').innerHTML = `x${params.relativeScale}`;
        }

        $$('#brush_size input').forEach((sel, i) => {
            if (uniforms.brush_size == 0.5 && i == 0) {
                sel.checked = true;
            } else if (uniforms.brush_size == 1.0 && i == 1) {
                sel.checked = true;
            } else if (uniforms.brush_size == 2.0 && i == 2) {
                sel.checked = true;
            }
        });

        $$('#brush_mode input').forEach((sel, i) => {
            if (!uniforms.brush_enabled && i == 2) {
                sel.checked = true;
            } else if (uniforms.brush_enabled && uniforms.brush_mode == i) {
                sel.checked = true;
            }
        });

        // reset all event listeners to avoid duplication
        document.onkeydown = null;
        document.onkeyup = null;
        canvas.onmousedown = null;
        canvas.onmousemove = null;
        canvas.onmouseup = null;
        canvas.ontouchstart = null;
        canvas.ontouchend = null;
        canvas.ontouchmove = null;

    }

    reset_ui();



    function init_event_listeners() {
        // rewrite addEventListeners here using keydown
        document.onkeydown = e => {
            if (e.key === 'r') {
                reset();
            }
            if (e.key === "Shift") {
                if (canvas.style.cursor != "grabbing") {
                    canvas.style.cursor = "grabbing";
                    last_cursor_style = canvas.style.cursor;
                }
            }
        };

        document.onkeyup = e => {
            if (e.key === "Shift") {
                canvas.style.cursor = "default";
                last_cursor_style = canvas.style.cursor;
            }
        }


        canvas.onmousedown = e => {
            e.preventDefault();
            // left click
            if (e.buttons == 1) {
                if (e.shiftKey) {
                    canvas.style.cursor = "grabbing";
                } else {
                    canvas.style.cursor = 'pointer';
                }
                click(getMousePos(e), e, true);
            }
        }
        canvas.onmousemove = e => {
            e.preventDefault();
            if (e.buttons == 1) {
                click(getMousePos(e), e, false);
            }
        }
        canvas.onmouseup = e => {
            e.preventDefault();
            canvas.style.cursor = last_cursor_style;
        }

        canvas.addEventListener("touchstart", e => {
            e.preventDefault();
            click(getTouchPos(e.changedTouches[0]), e, true);
        });
        canvas.addEventListener("touchmove", e => {
            e.preventDefault();
            for (const t of e.touches) {
                click(getTouchPos(t), e, false);
            }
        });

        $('#play-pause').onclick = () => {
            params.runModel = !params.runModel;
            $('#play').style.display = !params.runModel ? "inline" : "none";
            $('#pause').style.display = params.runModel ? "inline" : "none";
            // updateUI();
        };

        $('#reset').onclick = () => {
            reset();
        }

        $('#zoomIn').onclick = () => {
            uniforms.zoom += 0.5;
            $('#zoomOut').classList.remove("disabled");
            if (uniforms.zoom > 4.0) {
                uniforms.zoom = 4.0;
                $('#zoomIn').classList.add("disabled");
            }
            reset_camera();
        }

        $('#zoomOut').onclick = () => {
            uniforms.zoom -= 0.5;
            $('#zoomIn').classList.remove("disabled");
            if (uniforms.zoom < -1.0) {
                uniforms.zoom = -1.0;
                $('#zoomOut').classList.add("disabled");
            }
            reset_camera();
        }

        $$('#brush_size input').forEach((sel, i) => {
            sel.onchange = () => {
                if (i == 0) {
                    uniforms.brush_size = 0.5;
                } else {
                    if (i == 1) {
                        uniforms.brush_size = 1.0;
                    } else {
                        uniforms.brush_size = 2.0;
                    }
                }
            }

        });


        $$('#brush_mode input').forEach((sel, i) => {
            sel.onchange = () => {
                if (i == 2) {
                    uniforms.brush_enabled = false;
                } else {
                    uniforms.brush_enabled = true;
                    uniforms.brush_mode = i;
                }
            }
        });


        $('#speed').oninput = e => {
            const speed = parseInt(e.target.value);
            params.speed = speed;
            $('#speedLabel').innerHTML = ['1/8x', '1/4x', '1/2x', '1x', '2x', '4x', '8x'][speed + 3];
            // $('#speedLabel').innerText = params.step_n + "x";
        };

        $('#LPPN_scale').oninput = e => {
            const scale = parseInt(e.target.value);
            params.relativeScale = scale;
            $('#LPPN_scaleLabel').innerHTML = `x${scale}`;
            IMAGE_DIM = [64 * scale, 64 * scale];
            uniforms.samples_per_ray = 32 * scale;

            updateSiren();

        }

        $('#reset_on_load').onchange = e => {
            params.reset_upon_load = !e.target.checked;
        }



    }

    function getMousePos(e) {
        const gridX = e.offsetX / canvas.clientWidth;
        const gridY = e.offsetY / canvas.clientHeight;
        return [gridX, gridY];
    }

    function getTouchPos(touch) {
        const rect = canvas.getBoundingClientRect();
        const gridX = (touch.clientX - rect.left) / canvas.clientWidth;
        const gridY = (touch.clientY - rect.top) / canvas.clientHeight;
        return [gridX, gridY];
    }

    function click(pos, e, first_touch = false) {
        const [x, y] = pos;
        const [px, py] = prevPos;

        if (e.shiftKey || uniforms.brush_enabled == false) {

            let delta_phi = 0.0;
            let delta_theta = 0.0;

            if (!first_touch) {
                delta_phi = -(x - px) * 4.0;
                delta_theta = (y - py) * 4.0;
            }
            rotate_camera(delta_phi, delta_theta);
            prevPos = pos;
        } else {
            // Adjust with the aspect ratio
            const c = Math.min(canvas.clientWidth, canvas.clientHeight);
            const adjustedX = (x * 2.0 - 1.0) * (canvas.clientWidth / c);
            const adjustedY = -(y * 2.0 - 1.0) * (canvas.clientHeight / c);
            brush(adjustedX, adjustedY);
            prevPos = pos;
        }


    }

    function reset_camera() {
        const { theta, phi, distance, fov, znear, zfar, aspect } = camera;
        const zoom = uniforms.zoom;

        camera_uniforms.camera_position = [
            distance * Math.cos(theta * Math.PI / 180) * Math.cos(phi * Math.PI / 180) / Math.pow(2., zoom),
            distance * Math.cos(theta * Math.PI / 180) * Math.sin(phi * Math.PI / 180) / Math.pow(2., zoom),
            distance * Math.sin(theta * Math.PI / 180) / Math.pow(2., zoom)
        ];

        camera_uniforms.view = m4.inverse(m4.lookAt(camera_uniforms.camera_position, camera.look_at, camera.up));
        camera.focal = 1.0 / Math.tan(0.5 * camera.fov * Math.PI / 180.0);

        // alert(camera_uniforms.camera_position);
        // alert(camera.focal);
    }

    function rotate_camera(delta_phi, delta_theta) {
        let up = m4.normalize(camera.up);
        const { theta, phi, distance, fov, znear, zfar, aspect, look_at } = camera;
        const zoom = uniforms.zoom;
        let y_camera = m4.normalize(m4.subtractVectors(look_at, camera_uniforms.camera_position));

        let z_camera = m4.normalize(m4.subtractVectors(up, m4.scaleVector(up, m4.dot(y_camera, up))));

        let x_camera = m4.normalize(m4.cross(y_camera, z_camera));

        camera_uniforms.camera_position = m4.addVectors(camera_uniforms.camera_position, m4.scaleVector(x_camera, delta_phi));
        camera_uniforms.camera_position = m4.addVectors(camera_uniforms.camera_position, m4.scaleVector(z_camera, delta_theta));
        camera_uniforms.camera_position = m4.scaleVector(m4.normalize(camera_uniforms.camera_position), distance / Math.pow(2., zoom));



        camera_uniforms.view = m4.inverse(m4.lookAt(camera_uniforms.camera_position, look_at, up));
        camera_uniforms.projection = m4.perspective(fov * Math.PI / 180, aspect, znear, zfar);
    }


    init_event_listeners();


    async function init() {
        const response = await fetch(params.models_path);
        // const response = await fetch('./growing_nca.json');
        models = await response.json();

        let gridBox = $('#target-shelf');
        gridBox.innerHTML = '';
        $('#origtex').innerHTML = '';
        $('#origtex').style = '';
        $('#texhinttext').innerHTML = '';
        for (const name of target_names) {

            for (const k in models[name]) {
                const src = models[name][k];
                src.data = new Float32Array(
                    Uint8Array.from(atob(src.data64), c => c.charCodeAt(0)).buffer);
                delete src.data64;
            }

            let media_path = "./3d_texture_demo/target_images/" + name.toLowerCase() + ".jpg"
            console.log(media_path);
            media_path = media_path.replace(' + autocorr', '');


            const target_img = document.createElement('div');
            target_img.style.background = "url('" + media_path + "')";
            target_img.style.backgroundSize = "100% 100%";
            // target_img.style.backgroundSize = "100px100px";
            target_img.id = name; //html5 support arbitrary id:s
            target_img.className = 'target-square';
            target_img.onclick = () => {
                // removeOverlayIcon();
                currentTarget.style.borderColor = "white";
                currentTarget = target_img;
                target_img.style.borderColor = "rgb(245 140 44)";
                if (!window.matchMedia('(min-width: 500px)').matches && navigator.userAgent.includes("Chrome")) {
                    target_img.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
                }
                model = load_model(name);
                if (params.reset_upon_load) {
                    reset();
                }
                $("#origtex").style.background = "url('" + media_path + "')";
                $("#origtex").style.width = "224px";
                $("#origtex").style.height = "224px";
                $("#origtex").style.backgroundSize = "100% 100%";
                let desc = document.createElement('p')
                desc.innerHTML = "Model Name: " + name;
                // desc.href = "https://www.robots.ox.ac.uk/~vgg/data/dtd/"
                $("#texhinttext").innerHTML = '';
                $("#texhinttext").appendChild(desc);
            };


            if (name == params.model) {
                target_img.style.borderColor = "rgb(245 140 44)";
                gridBox.prepend(target_img);
                currentTarget = target_img;
                target_img.click();
            } else {
                gridBox.insertBefore(target_img, gridBox.lastElementChild);
            }
        }
        model = load_model(params.model);
        reset();
        reset_camera();
        frame();
    }

    init();

    function load_model(name) {
        const src = models[name];
        // init NCA
        const [ch, ci] = src['nca.w1.weight'].shape, co = src['nca.w2.weight.T'].shape[1];
        console.assert(co == CHN)
        const nca = {
            w1: glsl({}, {
                size: [ci / 4, ch], format: 'rgba32f',
                data: src['nca.w1.weight'].data, tag: 'w1'
            }),
            b1: glsl({}, {
                size: [1, ch], format: 'r32f',
                data: src['nca.w1.bias'].data, tag: 'b1'
            }),
            w2t: glsl({}, {
                size: [co / 4, ch], format: 'rgba32f',
                data: src['nca.w2.weight.T'].data, tag: 'w2t'
            }),
            Inc: `
            const ivec3 BLOCK_DIM = ivec3(${BLOCK_DIM[0]}, ${BLOCK_DIM[1]}, ${BLOCK_DIM[2]});
            const ivec2 GRID_DIM = ivec2(${GRID_DIM[0]}, ${GRID_DIM[1]});
            ivec2 voxel2grid(ivec3 voxel) {
                voxel = (voxel + BLOCK_DIM) % BLOCK_DIM;
                int x = voxel.x + (voxel.z % (GRID_DIM.x / BLOCK_DIM.x)) * BLOCK_DIM.x;
                int y = voxel.y + (voxel.z / (GRID_DIM.x / BLOCK_DIM.x)) * BLOCK_DIM.y;
                return ivec2(x, y);
            }
            ivec3 grid2voxel(ivec2 pixel) {
                pixel = (pixel + GRID_DIM) % GRID_DIM;
                int x = pixel.x % BLOCK_DIM.x;
                int y = pixel.y % BLOCK_DIM.y;
                int z = pixel.x / BLOCK_DIM.x + (pixel.y / BLOCK_DIM.y) * (GRID_DIM.x / BLOCK_DIM.x);
                return ivec3(x, y, z);
            }
            `
        };

        // init Siren
        // const sirenLayerN = 3;
        const sirenLayerN = 4;
        const sirenWidth = 32;
        // const inc = [`const int C4 = ${C4}; const int D4=(16+8)/4;`];
        const inc = [`const int C4 = ${C4}; const int D4=${sirenWidth}/4;`];
        const siren = {};
        for (let i = 0; i < sirenLayerN; ++i) {
            const last = i == sirenLayerN - 1;
            const s = `lppn.net.${i}` + (last ? '' : '.linear');
            const weight = src[s + '.weight'];
            const bias = src[s + '.bias'];
            const [no, ni] = weight.shape;
            inc.push(`
                uniform vec4 W${i}[${no * ni / 4}];
                uniform float B${i}[${no}];
                void run_layer${i}(in vec4 src[D4], out vec4 dst[D4]) {
                    const int no=${no}, ni=${ni};
                    for (int i=0; i<no; ++i) {
                        float a = B${i}[i];
                        #pragma unroll
                        for (int j=0; j<ni/4; ++j) {
                            a += dot(src[j], W${i}[i*ni/4 + j]);
                        }
                        dst[i/4][i%4] = ${last} ? a : sin(a*10.0);
                    }
                }`);
            siren['W' + i] = weight.data;
            siren['B' + i] = bias.data;
        }
        inc.push(nca['Inc']);
        siren['Inc'] = inc.join('\n');
        if (name in bg_color)
            uniforms['background'] = bg_color[name];
        else
            uniforms['background'] = 0.0;

        return { nca, siren };
    }


    function reset() {
        nca_grid = glsl({
            seed: 42, FP: `
            FOut = FOut1 = FOut2 = FOut3 = vec4(0);
            // FOut = FOut1 = FOut2 = vec4(0);
        `
        }, { size: GRID_DIM, layern: C4, format: 'rgba16f', story: 2, tag: 'grid' });
        // }, {size: [64, 64], layern: C4, format: 'rgba16f', story: 2, tag: 'grid'});
    }

    function brush(x, y) {
        const { nca } = model;
        glsl({
            ...nca, ...camera_uniforms, ...uniforms, x_pos: x, y_pos: y, FP: `
            ivec3 voxel = grid2voxel(I);
            vec3 pos_3d = (vec3(voxel) + 0.5) / vec3(BLOCK_DIM) * 2.0 - 1.0;
            vec4 vpos = vec4(pos_3d, 1.0);
            vpos = projection * view * vpos;
            vpos.xy /= vpos.w;
            float dist = length(vpos.xy - vec2(x_pos, y_pos));
            if (dist < 0.1 * brush_size) {
                FOut = FOut1 = FOut2 = FOut3 = vec4(0.0);
            } else {
                discard;
            }
        `
        }, nca_grid);

    }


    function step() {
        const { nca } = model;
        glsl({
            ...nca, seed: Math.random() * 26321,
            FP: `
            const int C4 = ${C4};
            const mat3 Kz[3] = mat3[](
                mat3(-1,0,1, -2,0,2, -1,0,1) / 2.0,
                mat3(-2,0,2, -4,0,4, -2,0,2) / 2.0,
                mat3(-1,0,1, -2,0,2, -1,0,1) / 2.0
            );
            const mat3 Klap[3] = mat3[](
                mat3(2,3,2, 3,6,3, 2,3,2) / 8.0,
                mat3(3,6,3, 6,-88,6, 3,6,3) / 8.0,
                mat3(2,3,2, 3,6,3, 2,3,2) / 8.0
            );

            vec4 perc[C4*5], upd[C4];
            
            void neib(int x, int y, int z) {
                ivec3 vox = grid2voxel(I) + ivec3(x-1, y-1, z-1);
                ivec2 pix = voxel2grid(vox);
                for (int i=0; i<C4; ++i) {
                    vec4 v = Src(pix,i);
                    perc[C4*3+i]   += Kz[y][z][x]*v;
                    perc[C4*2+i] += Kz[x][y][z]*v;
                    perc[C4*1+i] += Kz[z][x][y]*v;
                    perc[C4*4+i] += Klap[x][y][z]*v;
                }
            }

            void fragment() {
                for (int i=0; i<C4; ++i) {
                    upd[i] = perc[i] = Src(I,i);
                    perc[i+C4*4] = Klap[1][1][1]*upd[i];
                }
                FOut = upd[0]; FOut1 = upd[1]; FOut2 = upd[2]; FOut3 = upd[3];
                // FOut = upd[0]; FOut1 = upd[1]; FOut2 = upd[2];
                if (hash(ivec3(I,seed)).x>0.5) return;
                neib(0,0,0); neib(0,0,1); neib(0,0,2);
                neib(0,1,0); neib(0,1,1); neib(0,1,2);
                neib(0,2,0); neib(0,2,1); neib(0,2,2);

                neib(1,0,0); neib(1,0,1); neib(1,0,2);
                neib(1,1,0);              neib(1,1,2);
                neib(1,2,0); neib(1,2,1); neib(1,2,2);

                neib(2,0,0); neib(2,0,1); neib(2,0,2);
                neib(2,1,0); neib(2,1,1); neib(2,1,2);
                neib(2,2,0); neib(2,2,1); neib(2,2,2);
                
                int ci = w1_size().x, ch = w1_size().y;
                for (int h=0; h<ch; ++h) {
                    float y = b1(ivec2(0, h)).x;
                    for (int i=0; i<ci; ++i) {y += dot(perc[i], w1(ivec2(i, h)));}
                    if (y<=0.0) continue;
                    for (int i=0; i<C4; ++i) {upd[i] += y*w2t(ivec2(i, h));}
                }
                FOut = upd[0]; FOut1 = upd[1]; FOut2 = upd[2]; FOut3 = upd[3];
                // FOut = upd[0]; FOut1 = upd[1]; FOut2 = upd[2];
            }
        `
        }, nca_grid);
    }

    function updateSiren() {
        const { siren } = model;
        const [w, h] = nca_grid.size;
        siren_grid = glsl({
            nca_grid: nca_grid[0].nearest, ...siren, ...uniforms,
            ...camera_uniforms, ...camera, DEPTH_SAMPLE_DIST,
            FP: `
            vec4 A[D4], B[D4];
            vec3 bg_color = vec3(background);
            // vec4 bg_color = vec4(background);

            vec3 xyz_cam = vec3(XY.x, (1.0 - UV.y * 2.0), -focal);
            vec3 ray_direction = normalize(mat3(inverse(view)) * xyz_cam);
            vec3 ray_origin = camera_position;
            // vec3 inv_dir = 1.0 / (1e-8 + ray_direction);
            vec3 inv_dir = sign(ray_direction) / (abs(ray_direction) + vec3(1e-6));
            vec3 t_min = (-1.05 - ray_origin) * inv_dir;
            vec3 t_max = (1.05 - ray_origin) * inv_dir;
            vec3 t1 = min(t_min, t_max);
            vec3 t2 = max(t_min, t_max);
            float t_near = max(max(t1.x, t1.y), t1.z);
            float t_far = min(min(t2.x, t2.y), t2.z);
            if (t_near > t_far || t_far < 0.0) {
                FOut = vec4(bg_color, 1.0);
                // FOut = bg_color;
                return;
            }
            
            
            if (t_far - t_near < 0.1) {
                // FOut = vec4(1.0 - bg_color, 1.0);
                FOut = vec4(bg_color, 1.0);
                return;
            }
            t_near = max(znear, t_near);
            t_far = min(zfar, t_far);
            
            
            // FOut = vec4(vec3(dist) / 3.0, 1.0);
            // return;
            
            float transmittance = 1.0;
            vec4 output_color = vec4(0.0);
            float dist = t_near;
            // int num_samples = min(128, int(dist / DEPTH_SAMPLE_DIST));
            int num_samples = int(samples_per_ray);
            float delta = (t_far - t_near) / float(num_samples);

            for (int t = 0; t < num_samples; ++t) {
                vec3 sample_point = ray_origin + ray_direction * dist;
                if (max(abs(sample_point.x), max(abs(sample_point.y), abs(sample_point.z))) > 1.0) {
                    dist += delta;
                    continue;
                }

                vec3 p_3d = (sample_point / 2.0 + 0.5);
                vec3 coord_residual = fract(p_3d * float(BLOCK_DIM - 1)) * 2.0 - 1.0;
                p_3d = p_3d * float(BLOCK_DIM);
                ivec3 I_3d = ivec3(floor(p_3d));
                // vec3 pos_emb1 = sin(coord_residual * PI) * 1.0;
                // vec3 pos_emb2 = cos(coord_residual * PI) * 1.0;
                // A[0].xyz = pos_emb1;
                // A[0].w = pos_emb2.x;
                // A[1].xy = pos_emb2.yz;

                A[0].xyz = coord_residual;
                for (int i=0; i<C4; ++i) {
                    vec4 v = vec4(0.0);
                    for (int k=0; k<8; ++k) {
                        // Trilinear interpolation
                        ivec3 offset = ivec3((k & 1), ((k >> 1) & 1), ((k >> 2) & 1));
                        ivec2 I_2d = voxel2grid(I_3d + offset);
                        vec3 frac = fract(p_3d);
                        float w = (offset.x == 1) ? frac.x : (1.0 - frac.x);
                        w *= (offset.y == 1) ? frac.y : (1.0 - frac.y);
                        w *= (offset.z == 1) ? frac.z : (1.0 - frac.z);
                        v += nca_grid(I_2d,i) * w;
                    }
                    // vec4 v = nca_grid(I_2d,i);
                    A[i].w = v.x; A[i+1].xyz = v.yzw;
                }
                run_layer0(A, B); run_layer1(B, A);
                run_layer2(A, B); run_layer3(B, A);
                A[0] = max(A[0], vec4(0.0));
                float alpha = 1.0 - exp(-A[0].w * delta);
                output_color += A[0] * alpha * transmittance;
                transmittance *= 1.0 - alpha;
                dist += delta;
                // output_color = A[0];
                // break;
            }
            output_color.rgb += bg_color.rgb *  transmittance;
            output_color.a = 1.0;
            FOut = output_color;
        `
        }, {
            size: IMAGE_DIM, wrap: "mirror",
            format: 'rgba16f', layern: S4, tag: 'siren'
        })
    }


    function frame(time) {
        glsl.adjustCanvas();
        time /= 1000.0;
        if (params.runModel) {
            let step_n;
            if (params.speed <= 0) {
                step_n = (frame_count % [1, 2, 4, 8][-params.speed]) == 0 ? 1 : 0;
                frame_count += 1;
            } else {
                step_n = [1, 2, 4, 8][params.speed];
            }
            for (let i = 0; i < step_n; i++) {
                step();
            }
        }
        rotate_camera(0.005 * m4.length(camera_uniforms.camera_position), 0.0);
        updateSiren();
        glsl({
            state: nca_grid[0].linear, siren_grid: siren_grid.linear, Mesh: IMAGE_DIM, ...uniforms, ...camera_uniforms, Aspect: 'fit',
            time, DepthTest: 0, MeshMode: 1, Clear: uniforms['background'], FP: `
            void fragment() {
                vec2 uv = vec2(UV.x, 1.0 - UV.y);
                vec4 rgba = siren_grid(uv, 0);
                // vec4 rgba = state(uv / 8.0, 0);
                // rgba = (rgba + 1.0) / 2.0;
                FOut = vec4(rgba.xyz * 1.0, 1.0) / 1.0;
            }

        `
        });

        glsl.animation_id = requestAnimationFrame(frame);
    }

    const target_names = [
        "banded_0037",
        "bubbly_0101",
        "polka-doted_0121",
        "clouds",
        "cobwebbed_0059",
        "disco_fog",
        "fire",
        "flames",
        "grid_0040",
        "ink",
        "slime",
        "smoke",
        "smoke_2",
        "smoke_plume2",
        "snow",
        "spiralled_0112",
        "swirly_0071",
        "water",
    ]


}
