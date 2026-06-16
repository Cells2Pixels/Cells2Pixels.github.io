// CanvasRecorder.js - fixed-FPS WebM recorder for canvas output.
//
// MediaRecorder timestamps frames in wall-clock time. That makes a recording
// stutter when the page renders slowly. This recorder stores rendered canvas
// frames and writes them into a WebM with fixed frame timestamps, so playback is
// smooth even when capture itself is slow.

function CanvasRecorder(canvas, video_bits_per_sec, options = {}) {
    const fps = options.fps || 60;
    const quality = options.quality || 0.95;
    const background = options.background || '#ffffff';
    const frameDuration = 1000 / fps;
    const encoderCanvas = document.createElement('canvas');
    const encoderCtx = encoderCanvas.getContext('2d');

    let recordedFrames = [];
    let isRecording = false;
    let width = 0;
    let height = 0;

    this.start = startRecording;
    this.stop = stopRecording;
    this.save = download;
    this.captureFrame = captureFrame;
    this.requestFrame = captureFrame;
    this.getFrameCount = () => recordedFrames.length;

    function startRecording() {
        if (!encoderCtx) {
            alert('Canvas recording is not supported by this browser.');
            return false;
        }

        width = canvas.width;
        height = canvas.height;
        if (!width || !height) {
            alert('Canvas has no drawable size to record.');
            return false;
        }

        encoderCanvas.width = width;
        encoderCanvas.height = height;
        if (!isWebPSupported()) {
            alert('This browser cannot encode canvas frames as WebP, which is needed for fixed-FPS WebM recording.');
            return false;
        }

        recordedFrames = [];
        isRecording = true;
        console.log(`Canvas fixed-FPS recording started at ${fps} FPS.`);
        return true;
    }

    function stopRecording(callback) {
        if (!isRecording) {
            return;
        }
        isRecording = false;
        console.log(`Recorded ${recordedFrames.length} fixed-FPS frames.`);
        if (typeof callback === 'function') {
            callback();
        }
    }

    function captureFrame() {
        if (!isRecording) {
            return false;
        }

        encoderCtx.fillStyle = background;
        encoderCtx.fillRect(0, 0, width, height);
        encoderCtx.drawImage(canvas, 0, 0, width, height);

        const dataURL = encoderCanvas.toDataURL('image/webp', quality);
        const frame = parseWebPFrame(dataURL);
        if (!frame) {
            console.warn('Skipping frame because the browser did not produce a VP8 WebP image.');
            return false;
        }

        recordedFrames.push(frame);
        return true;
    }

    function download(file_name) {
        if (!recordedFrames.length) {
            alert('No frames were recorded.');
            return;
        }

        const name = file_name || 'recording.webm';
        const blob = createWebM(recordedFrames, width, height, frameDuration);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);
    }

    function isWebPSupported() {
        const dataURL = encoderCanvas.toDataURL('image/webp', quality);
        return dataURL.indexOf('data:image/webp') === 0 && !!parseWebPFrame(dataURL);
    }
}

function parseWebPFrame(dataURL) {
    if (typeof dataURL !== 'string' || dataURL.indexOf('data:image/webp') !== 0) {
        return null;
    }

    const comma = dataURL.indexOf(',');
    const binary = atob(dataURL.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    if (readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WEBP') {
        return null;
    }

    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const chunkId = readAscii(bytes, offset, 4);
        const chunkSize = readUInt32LE(bytes, offset + 4);
        const chunkStart = offset + 8;
        const chunkEnd = chunkStart + chunkSize;

        if (chunkEnd > bytes.length) {
            return null;
        }
        if (chunkId === 'VP8 ') {
            return bytes.slice(chunkStart, chunkEnd);
        }

        offset = chunkEnd + (chunkSize % 2);
    }

    return null;
}

function createWebM(frames, width, height, frameDuration) {
    const duration = frames.length * frameDuration;
    const clusters = createClusters(frames, frameDuration);
    const segment = ebmlElement(0x18538067, [
        ebmlElement(0x1549A966, [
            ebmlElement(0x2AD7B1, ebmlUnsigned(1000000)),
            ebmlElement(0x4D80, ebmlString('CanvasRecorder')),
            ebmlElement(0x5741, ebmlString('CanvasRecorder')),
            ebmlElement(0x4489, ebmlFloat64(duration)),
        ]),
        ebmlElement(0x1654AE6B, [
            ebmlElement(0xAE, [
                ebmlElement(0xD7, ebmlUnsigned(1)),
                ebmlElement(0x73C5, ebmlUnsigned(1)),
                ebmlElement(0x83, ebmlUnsigned(1)),
                ebmlElement(0x9C, ebmlUnsigned(0)),
                ebmlElement(0x86, ebmlString('V_VP8')),
                ebmlElement(0xE0, [
                    ebmlElement(0xB0, ebmlUnsigned(width)),
                    ebmlElement(0xBA, ebmlUnsigned(height)),
                ]),
            ]),
        ]),
        ...clusters,
    ]);

    const header = ebmlElement(0x1A45DFA3, [
        ebmlElement(0x4286, ebmlUnsigned(1)),
        ebmlElement(0x42F7, ebmlUnsigned(1)),
        ebmlElement(0x42F2, ebmlUnsigned(4)),
        ebmlElement(0x42F3, ebmlUnsigned(8)),
        ebmlElement(0x4282, ebmlString('webm')),
        ebmlElement(0x4287, ebmlUnsigned(2)),
        ebmlElement(0x4285, ebmlUnsigned(2)),
    ]);

    return new Blob([concatBytes([header, segment])], { type: 'video/webm' });
}

function createClusters(frames, frameDuration) {
    const clusters = [];
    let clusterStart = 0;
    let clusterBlocks = [];

    for (let i = 0; i < frames.length; i++) {
        const frameTime = Math.round(i * frameDuration);
        if (clusterBlocks.length && frameTime - clusterStart > 30000) {
            clusters.push(createCluster(clusterStart, clusterBlocks));
            clusterStart = frameTime;
            clusterBlocks = [];
        }

        clusterBlocks.push(createSimpleBlock(1, frameTime - clusterStart, frames[i]));
    }

    if (clusterBlocks.length) {
        clusters.push(createCluster(clusterStart, clusterBlocks));
    }

    return clusters;
}

function createCluster(timecode, blocks) {
    return ebmlElement(0x1F43B675, [
        ebmlElement(0xE7, ebmlUnsigned(timecode)),
        ...blocks,
    ]);
}

function createSimpleBlock(trackNumber, timecode, frame) {
    const block = new Uint8Array(4 + frame.length);
    block[0] = 0x80 | trackNumber;
    block[1] = (timecode >> 8) & 0xff;
    block[2] = timecode & 0xff;
    block[3] = 0x80;
    block.set(frame, 4);
    return ebmlElement(0xA3, block);
}

function ebmlElement(id, data) {
    const body = Array.isArray(data) ? concatBytes(data) : data;
    return concatBytes([ebmlId(id), ebmlSize(body.length), body]);
}

function ebmlId(id) {
    let hex = id.toString(16);
    if (hex.length % 2) {
        hex = '0' + hex;
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function ebmlSize(size) {
    let length = 1;
    while (length < 8 && size >= Math.pow(2, 7 * length) - 1) {
        length++;
    }

    const bytes = new Uint8Array(length);
    let value = size;
    for (let i = length - 1; i >= 0; i--) {
        bytes[i] = value & 0xff;
        value = Math.floor(value / 256);
    }
    bytes[0] |= 1 << (8 - length);
    return bytes;
}

function ebmlUnsigned(value) {
    let length = 1;
    while (value >= Math.pow(2, 8 * length)) {
        length++;
    }

    const bytes = new Uint8Array(length);
    for (let i = length - 1; i >= 0; i--) {
        bytes[i] = value & 0xff;
        value = Math.floor(value / 256);
    }
    return bytes;
}

function ebmlFloat64(value) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, false);
    return bytes;
}

function ebmlString(value) {
    return new TextEncoder().encode(value);
}

function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
}

function readAscii(bytes, offset, length) {
    let text = '';
    for (let i = 0; i < length; i++) {
        text += String.fromCharCode(bytes[offset + i]);
    }
    return text;
}

function readUInt32LE(bytes, offset) {
    return (bytes[offset]
        | (bytes[offset + 1] << 8)
        | (bytes[offset + 2] << 16)
        | (bytes[offset + 3] << 24)) >>> 0;
}
