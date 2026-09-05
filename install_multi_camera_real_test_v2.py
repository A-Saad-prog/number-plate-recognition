from pathlib import Path
import shutil
import re

ROOT = Path(__file__).resolve().parent
GARAGE = ROOT / "frontend" / "src" / "pages" / "GaragePage.jsx"
SERVICE = ROOT / "frontend" / "src" / "services" / "multiCameraVisionTestScheduler.js"
BACKUP = ROOT / "frontend" / "src" / "pages" / "GaragePage.jsx.multi-camera-test-backup"

if not GARAGE.exists():
    raise SystemExit("ERROR: Put this installer in the repository root.")

text = GARAGE.read_text(encoding="utf-8-sig")

if "MULTI_CAMERA_ORCHESTRATION_TEST" in text:
    raise SystemExit("Test patch already appears to be installed.")

if BACKUP.exists():
    BACKUP.unlink()

shutil.copy2(GARAGE, BACKUP)

def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly 1 match, found {count}")
    text = text.replace(old, new, 1)

def replace_all(old, new, label, minimum=1):
    global text
    count = text.count(old)
    if count < minimum:
        raise RuntimeError(f"{label}: expected at least {minimum} matches, found {count}")
    text = text.replace(old, new)

try:
    replace_once(
        'import { saveConfirmedPlateImage } from "../services/localPlateImages";',
        'import { saveConfirmedPlateImage } from "../services/localPlateImages";\n'
        'import { createMultiCameraVisionTestScheduler } from "../services/multiCameraVisionTestScheduler";',
        "scheduler import",
    )

    replace_once(
        'const GARAGE_SETTINGS_UPDATED_KEY = "parking_garage_settings_updated";',
        'const GARAGE_SETTINGS_UPDATED_KEY = "parking_garage_settings_updated";\n'
        'const MULTI_CAMERA_ORCHESTRATION_TEST = true;',
        "test flag",
    )

    replace_once(
        '    const activeVisionLoopsRef = useRef({});',
        '''    const activeVisionLoopsRef = useRef({});
    const multiCameraTestSchedulerRef = useRef(null);

    if (!multiCameraTestSchedulerRef.current) {
        multiCameraTestSchedulerRef.current = createMultiCameraVisionTestScheduler({
            maxConcurrent: 2,
        });
    }''',
        "scheduler ref",
    )

    replace_all(
        'if (!cameraId.startsWith(`${activeLaneRef.current}-`)) return;',
        'if (!MULTI_CAMERA_ORCHESTRATION_TEST && !cameraId.startsWith(`${activeLaneRef.current}-`)) return;',
        "lane start/run guards",
        minimum=2,
    )

    replace_once(
        '''            if (!cameraId.startsWith(`${activeLaneRef.current}-`)) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }''',
        '''            if (!MULTI_CAMERA_ORCHESTRATION_TEST && !cameraId.startsWith(`${activeLaneRef.current}-`)) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }''',
        "post-open lane guard",
    )

    replace_once(
        '''                const scale = Math.min(1, MAX_INFERENCE_FRAME_WIDTH / video.videoWidth);
                canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
                canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
                canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
                const result = await detectPlateFromFrame(canvas.toDataURL("image/jpeg", 0.82), cameraId);''',
        '''                const result = await multiCameraTestSchedulerRef.current.schedule(
                    cameraId,
                    async () => {
                        if (
                            !cameraStreamsRef.current[cameraId] ||
                            video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
                            !video.videoWidth ||
                            !video.videoHeight
                        ) {
                            return { detected: false, license_plate: null, box: null };
                        }

                        const scale = Math.min(1, MAX_INFERENCE_FRAME_WIDTH / video.videoWidth);
                        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
                        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
                        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

                        const image = canvas.toDataURL("image/jpeg", 0.82);
                        return detectPlateFromFrame(
                            image,
                            cameraId,
                            `mc-test-${cameraId}-${Date.now()}`
                        );
                    }
                );''',
        "scheduled vision call",
    )

    pattern = re.compile(
        r'laneGeneration\s*===\s*cameraLaneGenerationRef\.current\s*&&\s*'
        r'cameraId\.startsWith\(`\$\{activeLaneRef\.current\}-`\)'
    )
    replacement = '''(
                        MULTI_CAMERA_ORCHESTRATION_TEST ||
                        (
                            laneGeneration === cameraLaneGenerationRef.current &&
                            cameraId.startsWith(`${activeLaneRef.current}-`)
                        )
                    )'''
    text, guard_count = pattern.subn(replacement, text)

    if guard_count < 1:
        raise RuntimeError(
            f"post-result/finally lane guards: expected at least 1 flexible match, found {guard_count}"
        )

    replace_once(
        '        const isActiveLane = slot.lane.toLowerCase() === activeLane;',
        '        const isActiveLane = MULTI_CAMERA_ORCHESTRATION_TEST || slot.lane.toLowerCase() === activeLane;',
        "slot active lane",
    )

    replace_once(
        '                                    void startAutomaticExit(bestPlate, cameraId);',
        '''                                    if (!MULTI_CAMERA_ORCHESTRATION_TEST) {
                                        void startAutomaticExit(bestPlate, cameraId);
                                    } else {
                                        console.log("[MC TEST] Exit action blocked", {
                                            source: cameraId,
                                            plate: bestPlate,
                                        });
                                    }''',
        "block auto exit",
    )

    replace_once(
        '''                                        if (automaticEntryRef.current) {
                                            setVehicleAction("entry");
                                            void handleConfirmEntry(bestPlate, automaticSpace.id, cameraId);
                                        }''',
        '''                                        if (automaticEntryRef.current && !MULTI_CAMERA_ORCHESTRATION_TEST) {
                                            setVehicleAction("entry");
                                            void handleConfirmEntry(bestPlate, automaticSpace.id, cameraId);
                                        } else if (automaticEntryRef.current) {
                                            console.log("[MC TEST] Entry action blocked", {
                                                source: cameraId,
                                                plate: bestPlate,
                                                space: automaticSpace.id,
                                            });
                                        }''',
        "block auto entry",
    )

    replace_once(
        '<button type="button" className="lane-switch-button" onClick={switchActiveLane}>{activeLane === "entry" ? "Open Exit" : "Open Entry"}</button>',
        '''{MULTI_CAMERA_ORCHESTRATION_TEST ? (
                            <div className="status-message">
                                Multi-camera test mode: all assigned camera slots are active. Parking entry/exit writes are blocked.
                            </div>
                        ) : (
                            <button type="button" className="lane-switch-button" onClick={switchActiveLane}>
                                {activeLane === "entry" ? "Open Exit" : "Open Entry"}
                            </button>
                        )}''',
        "lane switch banner",
    )

    SERVICE.write_text(
'''export function createMultiCameraVisionTestScheduler({ maxConcurrent = 2 } = {}) {
    let active = 0;
    const queue = [];
    const queuedCameraIds = new Set();

    function log() {
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
''',
        encoding="utf-8",
    )

    GARAGE.write_text(text, encoding="utf-8")

except Exception:
    if BACKUP.exists():
        shutil.copy2(BACKUP, GARAGE)
        BACKUP.unlink()
    if SERVICE.exists():
        SERVICE.unlink()
    raise

print("INSTALLED OK")
print(f"Flexible lane guards patched: {guard_count}")
print("Changed: frontend/src/pages/GaragePage.jsx")
print("Added:   frontend/src/services/multiCameraVisionTestScheduler.js")
print("Backup:  frontend/src/pages/GaragePage.jsx.multi-camera-test-backup")
print()
print("Next:")
print("  cd frontend")
print("  npm run dev")
print("Open normal Garage: http://localhost:5173/")
