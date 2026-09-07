export function createMultiCameraVisionTestScheduler({ maxConcurrent = 2, debug = false } = {}) {
    let active = 0;
    const queue = [];
    const queuedCameraIds = new Set();

    function log() {
        if (!debug) return;
        console.log("[MC TEST scheduler]", {
            active,
            maxConcurrent,
            queued: queue.map((item) => item.cameraId),
        });
    }

    function pump() {
        while (active < maxConcurrent && queue.length > 0) {
            const item = queue.shift();
            queuedCameraIds.delete(item.cameraId);
            active += 1;
            log();

            Promise.resolve()
                .then(item.task)
                .then(item.resolve, item.reject)
                .finally(() => {
                    active = Math.max(0, active - 1);
                    log();
                    pump();
                });
        }
    }

    function schedule(cameraId, task) {
        return new Promise((resolve, reject) => {
            if (queuedCameraIds.has(cameraId)) {
                reject(new Error(`Duplicate queued vision job for ${cameraId}`));
                return;
            }

            queuedCameraIds.add(cameraId);
            queue.push({ cameraId, task, resolve, reject });
            pump();
        });
    }

    return { schedule };
}
