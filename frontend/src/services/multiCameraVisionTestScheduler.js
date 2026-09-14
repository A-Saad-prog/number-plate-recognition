export function createMultiCameraVisionTestScheduler({ maxConcurrent = 2, debug = false } = {}) {
    let active = 0;
    const pendingByCamera = new Map();
    const pendingOrder = [];
    const activeCameraIds = new Set();

    function log(cameraId, action) {
        if (!debug) return;
        console.debug("[Vision scheduler]", {
            camera: cameraId,
            action,
            active,
            maxConcurrent,
            pending: pendingOrder,
        });
    }

    function pump() {
        while (active < maxConcurrent && pendingOrder.length > 0) {
            // Leave jobs for active cameras in place: each one is that
            // camera's single latest pending frame, to run after its active
            // request completes. Start the first eligible camera instead.
            const pendingIndex = pendingOrder.findIndex(
                (cameraId) => !activeCameraIds.has(cameraId)
            );
            if (pendingIndex < 0) return;

            const [cameraId] = pendingOrder.splice(pendingIndex, 1);
            const item = pendingByCamera.get(cameraId);
            pendingByCamera.delete(cameraId);
            if (!item) continue;
            active += 1;
            activeCameraIds.add(cameraId);
            log(cameraId, "start-latest");

            Promise.resolve()
                .then(item.task)
                .then(item.resolve, item.reject)
                .finally(() => {
                    active = Math.max(0, active - 1);
                    activeCameraIds.delete(cameraId);
                    pump();
                });
        }
    }

    function schedule(cameraId, task) {
        return new Promise((resolve, reject) => {
            const existing = pendingByCamera.get(cameraId);
            if (existing) {
                // Replacing a stale frame is expected, never an error.
                existing.resolve({ discarded: true });
                pendingByCamera.set(cameraId, { cameraId, task, resolve, reject });
                log(cameraId, "replace-stale");
            } else {
                pendingByCamera.set(cameraId, { cameraId, task, resolve, reject });
                pendingOrder.push(cameraId);
                log(cameraId, "queue-latest");
            }
            pump();
        });
    }

    function cancel(cameraId) {
        const pending = pendingByCamera.get(cameraId);
        if (!pending) return;
        pendingByCamera.delete(cameraId);
        const index = pendingOrder.indexOf(cameraId);
        if (index >= 0) pendingOrder.splice(index, 1);
        pending.resolve({ discarded: true });
        log(cameraId, "cancel-pending");
    }

    return { schedule, cancel };
}
