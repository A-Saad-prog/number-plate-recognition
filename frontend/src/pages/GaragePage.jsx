import { useEffect, useRef, useState } from "react";

import {
    getParkingSpaces,
    registerEntry,
    getActiveParkingSession,
    exitUsingPlate,
    getExitPaymentRequired,
    detectPlateFromFrame,
    getGarageSettings,
} from "../services/api";

import VehicleInformation from "../components/VehicleInformation";
import { saveConfirmedPlateImage } from "../services/localPlateImages";
import { createMultiCameraVisionTestScheduler } from "../services/multiCameraVisionTestScheduler";

import "../styles/App.css";

const MAX_INFERENCE_FRAME_WIDTH = 960;
const VISION_REQUEST_INTERVAL_MS = 300;
const VISION_DEBUG = import.meta.env.DEV && import.meta.env.VITE_VISION_DEBUG === "true";
const GARAGE_SETTINGS_UPDATED_KEY = "parking_garage_settings_updated";
const MULTI_CAMERA_ORCHESTRATION_TEST = false;
const PARTIAL_GUARD_EVIDENCE_TTL_MS = 3000;
const PARTIAL_GUARD_STRONG_CONFIDENCE = 0.85;
const VERY_HIGH_OCR_CONFIDENCE = 0.92;
const MEDIUM_OCR_CONFIDENCE = 0.80;
const MIN_VOTING_CONFIDENCE = 0.60;

function boxesEqual(first, second) {
    if (first === second) return true;
    if (!first || !second) return false;
    return first.x1 === second.x1 && first.y1 === second.y1 && first.x2 === second.x2 && first.y2 === second.y2;
}

function openOrFocusNamedTab(url, name) {
    const target = window.open("", name);
    if (!target) return;

    try {
        if (
            target.location.origin !== window.location.origin ||
            target.location.pathname !== url
        ) {
            target.location.href = url;
        }
    } catch {
        target.location.href = url;
    }

    target.focus();
}

function GaragePage() {
    useEffect(() => {
        window.name = "parkingos-garage";
    }, []);

    const [cameraAssignments] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem("parking_camera_assignments")) || {};
        } catch {
            return {};
        }
    });
    const [detectedPlate, setDetectedPlate] = useState("");
    const [vehicleAction, setVehicleAction] = useState(null);
    const [detectionSource, setDetectionSource] = useState(null);
    const [cameraVehicleState, setCameraVehicleState] = useState({});
    const [activeEntryCameraId, setActiveEntryCameraId] = useState(null);

    function updateCameraVehicleState(cameraId, updates) {
        setCameraVehicleState((current) => ({
            ...current,
            [cameraId]: {
                ...(current[cameraId] || {}),
                ...updates,
            },
        }));
    }

    function clearCameraVehicleState(cameraId) {
        setCameraVehicleState((current) => {
            if (!current[cameraId]) return current;
            const next = { ...current };
            delete next[cameraId];
            return next;
        });
    }

    const detectedPlateRef = useRef({});
    const lastCompletedPlateRef = useRef({});
    const plateCandidateRef = useRef("");
    const plateCandidateCountRef = useRef(0);
    const plateVoteHistoryRef = useRef({});
    const partialPlateEvidenceRef = useRef({});

    // PARTIAL_PLATE_LOCK_GUARD_V2
    const plateCandidateFirstSeenRef = useRef({});
    const confirmedPlateLockRef = useRef({});
    const confirmedPlateLastDetectedAtRef = useRef({});
    const confirmedLockImageRef = useRef({});
    const completedLockActionRef = useRef({});
    const savedLockImageRef = useRef({});
    const activeDetectionSourceRef = useRef("entry-1");
    const entrySubmittingRef = useRef({});
    const exitSubmittingRef = useRef({});
    const automaticExitAttemptRef = useRef({});
    const pendingAutomaticExitRef = useRef({});
    const exitPaymentPrefetchRef = useRef({});
    const terminalClearTimersRef = useRef({});

    const [selectedSpaceId, setSelectedSpaceId] = useState(null);
    const [entryLoading, setEntryLoading] = useState(false);
    const [entryError, setEntryError] = useState("");
    const [alreadyParked, setAlreadyParked] = useState(false);
    const [entryResult, setEntryResult] = useState(null);

    const [exitLoading, setExitLoading] = useState(false);
    const [exitError, setExitError] = useState("");
    const [exitResult, setExitResult] = useState(null);
    const [paymentMethod, setPaymentMethod] = useState(null);
    const [exitPaymentRequired] = useState(false);
    const [exitRatePerMinute, setExitRatePerMinute] = useState(null);

    function clearPlateCandidates(source) {
        for (const key of Object.keys(plateCandidateFirstSeenRef.current)) {
            if (key.startsWith(`${source}:`)) {
                delete plateCandidateFirstSeenRef.current[key];
            }
        }

        delete partialPlateEvidenceRef.current[source];
    }

    function clearCompletedCameraPlate(source) {
        window.clearTimeout(terminalClearTimersRef.current[source]);
        delete terminalClearTimersRef.current[source];
        delete detectedPlateRef.current[source];
        delete confirmedPlateLockRef.current[source];
        delete confirmedPlateLastDetectedAtRef.current[source];
        delete confirmedLockImageRef.current[source];
        delete completedLockActionRef.current[source];
        delete automaticExitAttemptRef.current[source];
        delete pendingAutomaticExitRef.current[source];
        delete exitPaymentPrefetchRef.current[source];
        clearPlateCandidates(source);
        plateVoteHistoryRef.current[source] = { reads: [], lastSeenAt: 0 };
    }

    function scheduleTerminalCameraClear(cameraId, plate) {
        window.clearTimeout(terminalClearTimersRef.current[cameraId]);
        terminalClearTimersRef.current[cameraId] = window.setTimeout(() => {
            if (
                detectedPlateRef.current[cameraId] !== plate ||
                confirmedPlateLockRef.current[cameraId] !== plate
            ) return;
            clearCompletedCameraPlate(cameraId);
            clearCameraVehicleState(cameraId);
        }, 1000);
    }

    async function resolveConfirmedCameraPlate(cameraId, plate, image) {
        const trackingMode = adminSettings?.garage_settings?.mode === "tracking";
        const isEntry = cameraId.startsWith("entry-");
        updateCameraVehicleState(cameraId, {
            plate,
            action: null,
            loading: true,
            alreadyParked: false,
            selectedSpaceId: null,
            entryResult: null,
            exitResult: null,
            paymentRequired: false,
            paymentMethod: null,
            ratePerMinute: null,
            error: "",
        });

        let active;
        try {
            const result = await getActiveParkingSession(plate);
            if (
                detectedPlateRef.current[cameraId] !== plate ||
                confirmedPlateLockRef.current[cameraId] !== plate
            ) return;
            active = Boolean(result.active);
        } catch (error) {
            if (detectedPlateRef.current[cameraId] !== plate) return;
            updateCameraVehicleState(cameraId, { loading: false, action: null, error: error.message || "Could not check vehicle status." });
            return;
        }

        if (isEntry && active) {
            updateCameraVehicleState(cameraId, {
                plate, action: null, loading: false, alreadyParked: true,
                selectedSpaceId: null, error: "",
            });
            scheduleTerminalCameraClear(cameraId, plate);
            return;
        }

        if (!isEntry && !active) {
            updateCameraVehicleState(cameraId, {
                plate, action: null, loading: false, selectedSpaceId: null,
                error: trackingMode ? "Vehicle is not currently logged." : "Vehicle is not parked in the garage.",
            });
            scheduleTerminalCameraClear(cameraId, plate);
            return;
        }

        if (isEntry) {
            if (trackingMode) {
                if (automaticEntryRef.current && !MULTI_CAMERA_ORCHESTRATION_TEST) {
                    void handleConfirmEntry(plate, null, cameraId, true);
                } else {
                    updateCameraVehicleState(cameraId, { plate, action: "entry", loading: false, selectedSpaceId: null, error: "" });
                }
                return;
            }

            const parkedSpace = parkingSpacesRef.current.find(
                (space) => space.is_occupied && space.license_plate === plate
            );
            if (parkedSpace) {
                updateCameraVehicleState(cameraId, { plate, action: null, loading: false, alreadyParked: true, selectedSpaceId: null, error: "" });
                scheduleTerminalCameraClear(cameraId, plate);
                return;
            }

            if (automaticEntryRef.current && !MULTI_CAMERA_ORCHESTRATION_TEST) {
                void handleConfirmEntry(plate, null, cameraId, true);
                return;
            }
            const automaticSpace = getAutomaticParkingSpace();
            updateCameraVehicleState(cameraId, automaticSpace
                ? { plate, action: "entry", loading: false, selectedSpaceId: automaticSpace.id, error: "" }
                : { plate, action: null, loading: false, selectedSpaceId: null, error: "No parking space is available for this vehicle." });
            return;
        }

        if (trackingMode) {
            updateCameraVehicleState(cameraId, { plate, action: "exit", loading: false, selectedSpaceId: null, paymentRequired: false, paymentMethod: null, error: "" });
        } else {
            updateCameraVehicleState(cameraId, { plate, action: null, loading: true, selectedSpaceId: null, error: "" });
            void prefetchExitPaymentRequired(plate, cameraId);
            void startAutomaticExit(plate, cameraId);
        }
    }

    function saveConfirmedLockImageAfterAction(plate, source) {
        const lockId = confirmedPlateLockRef.current[source] || plate;
        const action = source.startsWith("exit-") ? "exit" : "entry";
        const saveKey = `${source}:${lockId}:${action}`;
        const logPrefix = `[Local image] ${action.toUpperCase()} save`;
        if (!localImageSavingRef.current) {
            console.info(`${logPrefix} skipped: local saving is disabled in Garage settings`);
            return;
        }
        if (savedLockImageRef.current[saveKey]) {
            console.info(`${logPrefix} skipped: this lock lifecycle was already saved`);
            return;
        }
        const imageDataUrl = confirmedLockImageRef.current[source];
        if (!imageDataUrl) {
            console.info(`${logPrefix} skipped: no cached confirmed-lock frame for ${source}`);
            return;
        }
        savedLockImageRef.current[saveKey] = true;
        console.info(`${logPrefix} start`, { plate, source, lockId });
        void saveConfirmedPlateImage({ plate, source, imageDataUrl })
            .then((saved) => {
                console.info(saved ? `${logPrefix} success` : `${logPrefix} skipped: folder handle or write permission is unavailable`);
            })
            .catch((error) => {
                console.info(`${logPrefix} skipped: ${error?.message || "write failed"}`);
            });
    }

    function prefetchExitPaymentRequired(plate, source) {
        const cached = exitPaymentPrefetchRef.current[source] || {};
        if (cached.plate === plate && (cached.promise || cached.result)) {
            return cached.promise || Promise.resolve(cached.result);
        }

        const promise = getExitPaymentRequired(plate)
            .then((result) => {
                if (exitPaymentPrefetchRef.current[source]?.plate === plate) {
                    exitPaymentPrefetchRef.current[source] = { plate, promise: null, result, error: null };
                }
                return result;
            })
            .catch((error) => {
                if (exitPaymentPrefetchRef.current[source]?.plate === plate) {
                    exitPaymentPrefetchRef.current[source] = { plate, promise: null, result: null, error };
                }
                return null;
            });

        exitPaymentPrefetchRef.current[source] = { plate, promise, result: null, error: null };
        return promise;
    }

    async function getPrefetchedExitPaymentRequired(plate, source) {
        const cached = exitPaymentPrefetchRef.current[source] || {};
        if (cached.plate === plate) {
            if (cached.result) return cached.result;
            if (cached.promise) {
                const result = await cached.promise;
                if (result) return result;
            }
            if (exitPaymentPrefetchRef.current[source]?.error) {
                throw exitPaymentPrefetchRef.current[source].error;
            }
        }
        return getExitPaymentRequired(plate);
    }

    const [parkingSpaces, setParkingSpaces] = useState([]);
    const parkingSpacesRef = useRef([]);
    const [parkingLoading, setParkingLoading] = useState(false);
    const [parkingError, setParkingError] = useState("");
    const [openLevel, setOpenLevel] = useState(1);
    const [adminSettings, setAdminSettings] = useState(null);
    const localImageSavingRef = useRef(false);
    const automaticEntryRef = useRef(false);
    const [garageAuthFailed, setGarageAuthFailed] = useState(false);
    const garageAuthFailedRef = useRef(false);
    const [showSettingsReloadNotice, setShowSettingsReloadNotice] = useState(false);
    const [activeLane, setActiveLane] = useState("entry");
    const activeLaneRef = useRef("entry");
    const [cameraViews, setCameraViews] = useState({});
    const cameraStreamsRef = useRef({});
    const cameraNodesRef = useRef({});
    const cameraCanvasesRef = useRef({});
    const cameraRequestsRef = useRef({});
    const cameraTimersRef = useRef({});
    const cameraStartingRefBySlot = useRef({});
    const cameraLaneGenerationRef = useRef(0);
    const activeVisionLoopsRef = useRef({});
    const multiCameraTestSchedulerRef = useRef(null);

    if (!multiCameraTestSchedulerRef.current) {
        multiCameraTestSchedulerRef.current = createMultiCameraVisionTestScheduler({
            maxConcurrent: 2,
        });
    }

    function debugVisionLoopStatus(source, phase) {
        if (!VISION_DEBUG) return;

        if (phase === "start") {
            activeVisionLoopsRef.current[source] = performance.now();
        } else if (phase === "end") {
            delete activeVisionLoopsRef.current[source];
        }

        const activeSources = Object.keys(activeVisionLoopsRef.current);
        const legacyEntryActive = activeSources.some((id) => id === "entry" || id === "entry-1");
        const legacyExitActive = activeSources.some((id) => id === "exit" || id === "exit-1");
        const slotLoopActive = activeSources.some((id) => id.startsWith("slot-") || id.includes("slot-"));

        console.debug(
            `[Vision FE loops] count=${activeSources.length} active=${activeSources.join(",") || "none"} legacy_entry=${legacyEntryActive} legacy_exit=${legacyExitActive} slot_active=${slotLoopActive}`
        );
    }

    const videoRef = useRef(null);
    const exitVideoRef = useRef(null);
    const exitStreamRef = useRef(null);
    const canvasRef = useRef(null);
    const visionProcessingRef = useRef(false);
    const cameraStartingRef = useRef(false);

    const [cameraError, setCameraError] = useState("");
    const [cameraActive, setCameraActive] = useState(false);
    const [exitCameraError, setExitCameraError] = useState("");
    const [exitCameraActive, setExitCameraActive] = useState(false);
    const [entryDetectionBox, setEntryDetectionBox] = useState(null);
    const [exitDetectionBox, setExitDetectionBox] = useState(null);


    // ============================================================
    // Camera Vision
    // ============================================================

    async function processCameraFrame(
        videoRefToProcess,
        cameraIsActive,
        source
    ) {
        if (
            source !== activeDetectionSourceRef.current ||
            !videoRefToProcess.current ||
            !canvasRef.current ||
            !cameraIsActive ||
            visionProcessingRef.current
        ) {
            return false;
        }

        const video = videoRefToProcess.current;
        const canvas = canvasRef.current;

        if (
            video.readyState <
            HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
            return false;
        }

        const requestId = `fe-${source}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const requestStartAt = performance.now();
        const captureStart = performance.now();
        const context = canvas.getContext("2d");
        const scale = Math.min(1, MAX_INFERENCE_FRAME_WIDTH / video.videoWidth);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

        context.drawImage(
            video,
            0,
            0,
            canvas.width,
            canvas.height
        );

        const captureMs = performance.now() - captureStart;
        const encodeStartedAt = performance.now();
        const image = canvas.toDataURL(
            "image/jpeg",
            0.82
        );
        const encodeMs = performance.now() - encodeStartedAt;

        if (VISION_DEBUG) {
            debugVisionLoopStatus(source, "start");
            console.debug(
                `[Vision FE] id=${requestId} source=${source} capture=${captureMs.toFixed(1)}ms encode=${encodeMs.toFixed(1)}ms request_start=${requestStartAt.toFixed(1)}ms`
            );
        }

        try {
            visionProcessingRef.current = true;
            const apiStartedAt = performance.now();
            const result =
                await detectPlateFromFrame(image, source, requestId);
            const resultReceivedAt = performance.now();
            const apiMs = resultReceivedAt - apiStartedAt;
            const totalMs = resultReceivedAt - requestStartAt;
            const renderHandoffStartedAt = performance.now();

            if (source !== activeDetectionSourceRef.current) {
                return false;
            }

            if (VISION_DEBUG) {
                const renderHandoffMs = performance.now() - renderHandoffStartedAt;
                console.debug(
                    `[Vision FE] id=${requestId} source=${source} api=${apiMs.toFixed(1)}ms total=${totalMs.toFixed(1)}ms render_handoff=${renderHandoffMs.toFixed(1)}ms detected=${Boolean(result?.detected)} plate=${result?.license_plate || "n/a"}`
                );
            }

            if (source.startsWith("entry-")) {
                setEntryDetectionBox((current) => boxesEqual(current, result.box) ? current : result.box || null);
            } else {
                setExitDetectionBox((current) => boxesEqual(current, result.box) ? current : result.box || null);
            }

            if (result.detected && confirmedPlateLockRef.current[source]) {
                confirmedPlateLastDetectedAtRef.current[source] = Date.now();
            }

            if (
                result.detected &&
                result.license_plate
            ) {
                if (
                    !result.detected ||
                    !result.license_plate
                ) {
                    plateCandidateRef.current = "";
                    plateCandidateCountRef.current = 0;
                    return;
                }

                const plate = result.license_plate
                    .trim()
                    .toUpperCase();

                if (
                    plate === detectedPlateRef.current[source] ||
                    plate === lastCompletedPlateRef.current[source]
                ) {
                    return;
                }

                const voteState =
                    plateVoteHistoryRef.current[source] || {
                        reads: [],
                        lastSeenAt: 0,
                    };

                const now = Date.now();

                if (
                    voteState.lastSeenAt &&
                    now - voteState.lastSeenAt >
                    (MULTI_CAMERA_ORCHESTRATION_TEST ? 5000 : 1500)
                ) {
                    voteState.reads = [];
                }

                voteState.lastSeenAt = now;
                voteState.reads.push({
                    plate,
                    confidence: Number(result.confidence || 0),
                });

                voteState.reads = voteState.reads.slice(-5);
                plateVoteHistoryRef.current[source] = voteState;

                const voteCounts = {};
                for (const read of voteState.reads) {
                    voteCounts[read.plate] =
                        (voteCounts[read.plate] || 0) + 1;
                }

                const bestVote = Object.entries(voteCounts)
                    .sort((a, b) => b[1] - a[1])[0];

                const bestPlate = bestVote?.[0] || plate;
                const bestCount = bestVote?.[1] || 1;

                const normalizedBest = bestPlate.replace(/[^A-Z0-9]/gi, "").toUpperCase();
                const longerCompatiblePlate = voteState.reads
                    .map((read) => read.plate)
                    .filter(Boolean)
                    .find((candidate) => {
                        const normalizedCandidate = candidate.replace(/[^A-Z0-9]/gi, "").toUpperCase();
                        if (normalizedCandidate.length <= normalizedBest.length) return false;
                        if (normalizedCandidate.startsWith(normalizedBest) || normalizedCandidate.endsWith(normalizedBest)) return true;
                        let index = 0;
                        for (const character of normalizedCandidate) {
                            if (character === normalizedBest[index]) index += 1;
                        }
                        return index === normalizedBest.length;
                    });
                const candidateKey = `${source}:${bestPlate}`;
                if (!plateCandidateFirstSeenRef.current[candidateKey]) {
                    plateCandidateFirstSeenRef.current[candidateKey] = now;
                }
                const isCustomNumeric = /^\d{1,4}$/.test(normalizedBest);

                // Require one extra matching OCR read before locking.
                // This reduces false locks while keeping latency low.
                const requiredVotes = 4;

                // Keep normal plates fast.
                // Short numeric plates remain stricter because they are easier to misread.
                const requiredAgeMs = isCustomNumeric ? 1200 : 700;

                const stablePlate =
                    bestCount >= requiredVotes &&
                    now - plateCandidateFirstSeenRef.current[candidateKey] >= requiredAgeMs &&
                    !longerCompatiblePlate;

                if (VISION_DEBUG) {
                    console.debug("[Plate vote]", {
                        source,
                        reads: voteState.reads,
                        bestPlate,
                        bestCount,
                        requiredVotes,
                        windowSize: 5,
                        stablePlate,
                    });
                }

                if (stablePlate) {
                    if (lastCompletedPlateRef.current[source] !== bestPlate) {
                        delete lastCompletedPlateRef.current[source];
                    }
                    detectedPlateRef.current[source] = bestPlate;

                    plateCandidateRef.current = "";
                    plateCandidateCountRef.current = 0;
                    plateVoteHistoryRef.current[source] = {
                        reads: [],
                        lastSeenAt: now,
                    };

                    const plate = bestPlate;

                    if (VISION_DEBUG) {
                        console.debug("[Plate accepted]", { source, plate });
                    }

                    setDetectedPlate(plate);
                    setDetectionSource(source);
                    setVehicleAction(null);

                    confirmedPlateLockRef.current[source] = plate;
                    confirmedPlateLastDetectedAtRef.current[source] = now;
                    confirmedLockImageRef.current[source] = image;
                    void resolveConfirmedCameraPlate(source, plate, image);
                }
            } else {
                lastCompletedPlateRef.current[source] = "";

                const now = Date.now();
                const voteState = plateVoteHistoryRef.current[source];

                if (
                    voteState?.lastSeenAt &&
                    now - voteState.lastSeenAt > 1500
                ) {
                    plateVoteHistoryRef.current[source] = {
                        reads: [],
                        lastSeenAt: 0,
                    };
                }

            }

        } catch (error) {
            if (VISION_DEBUG) {
                console.debug("Vision processing error:", error);
            }
            return false;
        } finally {
            visionProcessingRef.current = false;
            if (VISION_DEBUG) {
                debugVisionLoopStatus(source, "end");
            }
        }

        return true;
    }


    function renderDetectionBox(box, videoRefToUse) {
        const video = videoRefToUse.current;

        if (
            !box ||
            !video ||
            !video.videoWidth ||
            !video.videoHeight
        ) {
            return null;
        }

        return (
            <div
                className="plate-detection-box"
                style={{
                    left: `${(box.x1 / video.videoWidth) * 100}%`,
                    top: `${(box.y1 / video.videoHeight) * 100}%`,
                    width: `${((box.x2 - box.x1) / video.videoWidth) * 100}%`,
                    height: `${((box.y2 - box.y1) / video.videoHeight) * 100}%`,
                }}
            >
                <span>License plate</span>
            </div>
        );
    }


    async function startCamera(
        videoRefToStart,
        setActive,
        setError,
        cameraId
    ) {
        if (cameraStartingRef.current) {
            return;
        }

        if (!cameraAssignments[cameraId]) {
            setActive(false);
            return;
        }

        cameraStartingRef.current = true;
        let stream = null;

        try {
            setError("");

            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error("Camera access is not supported by this browser.");
            }

            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: cameraAssignments[cameraId]
                        ? { deviceId: { exact: cameraAssignments[cameraId] } }
                        : {
                            width: { ideal: 640 },
                            height: { ideal: 480 },
                            facingMode: { ideal: "environment" },
                        },
                    audio: false,
                });
            } catch (constraintError) {
                if (constraintError.name !== "OverconstrainedError") {
                    throw constraintError;
                }

                stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false,
                });
            }

            if (videoRefToStart.current) {
                const video = videoRefToStart.current;
                video.srcObject = stream;

                await video.play();
            } else if (
                videoRefToStart === exitVideoRef
            ) {
                exitStreamRef.current = stream;
            } else {
                stream.getTracks().forEach((track) => track.stop());
                throw new Error("The camera preview is not ready yet.");
            }

            setActive(true);

        } catch (error) {
            stream?.getTracks().forEach((track) => track.stop());
            console.error(
                "Camera error:",
                error
            );

            const message = error.name === "NotAllowedError"
                ? "Camera permission was denied. Allow camera access and reload the page."
                : error.name === "NotFoundError"
                    ? "No camera was found on this device."
                    : error.name === "NotReadableError"
                        ? "The camera is already in use by another app or browser tab. Close it and reload the page."
                        : error.message || "Could not access the camera.";

            setError(message);
        } finally {
            cameraStartingRef.current = false;
        }
    }


    function clearVehicleDetectionState() {
        Object.values(terminalClearTimersRef.current).forEach((timer) => window.clearTimeout(timer));
        terminalClearTimersRef.current = {};
        detectedPlateRef.current = {};
        lastCompletedPlateRef.current = {};
        automaticExitAttemptRef.current = {};
        pendingAutomaticExitRef.current = {};
        exitPaymentPrefetchRef.current = {};
        plateCandidateRef.current = "";
        plateCandidateCountRef.current = 0;
        plateVoteHistoryRef.current = {};
        plateCandidateFirstSeenRef.current = {};
        confirmedPlateLockRef.current = {};
        confirmedPlateLastDetectedAtRef.current = {};
        confirmedLockImageRef.current = {};
        completedLockActionRef.current = {};
        savedLockImageRef.current = {};

        setDetectedPlate("");
        setDetectionSource(null);
        setVehicleAction(null);
        setEntryError("");
        setAlreadyParked(false);
        setExitError("");
        setEntryResult(null);
        setExitResult(null);
        setPaymentMethod(null);
        setSelectedSpaceId(null);
        setExitRatePerMinute(null);
        setCameraVehicleState({});
        setActiveEntryCameraId(null);
    }


    async function openExitCamera() {
        activeDetectionSourceRef.current = "exit-1";

        const entryStream =
            videoRef.current?.srcObject;

        if (entryStream) {
            entryStream
                .getTracks()
                .forEach((track) =>
                    track.stop()
                );
        }

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }

        clearVehicleDetectionState();
        setCameraActive(false);
        setEntryDetectionBox(null);

        await startCamera(
            exitVideoRef,
            setExitCameraActive,
            setExitCameraError,
            "exit-1"
        );
    }


    function closeExitCamera() {
        activeDetectionSourceRef.current = "entry-1";

        const stream =
            exitVideoRef.current?.srcObject ||
            exitStreamRef.current;

        if (stream) {
            stream
                .getTracks()
                .forEach((track) =>
                    track.stop()
                );
        }

        if (exitVideoRef.current) {
            exitVideoRef.current.srcObject = null;
        }

        clearVehicleDetectionState();
        exitStreamRef.current = null;
        setExitCameraActive(false);
        setExitDetectionBox(null);

        startCamera(
            videoRef,
            setCameraActive,
            setCameraError,
            "entry-1"
        );
    }


    function formatDateTime(value) {
        if (!value) {
            return "Unknown";
        }

        const date = parseBackendDate(value);

        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return date.toLocaleString("en-PK", {
            dateStyle: "medium",
            timeStyle: "medium",
            timeZone: "Asia/Karachi",
        });
    }


    function parseBackendDate(value) {
        if (typeof value !== "string") {
            return new Date(value);
        }

        const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
        return new Date(hasTimezone ? value : `${value}+05:00`);
    }


    function formatDuration(entryTime, exitTime) {
        const entry = parseBackendDate(entryTime);
        const exit = parseBackendDate(exitTime);

        if (
            Number.isNaN(entry.getTime()) ||
            Number.isNaN(exit.getTime())
        ) {
            return "Unknown";
        }

        const totalSeconds = Math.max(
            0,
            Math.floor(
                (exit.getTime() -
                    entry.getTime()) /
                1000
            )
        );

        const hours =
            Math.floor(totalSeconds / 3600);

        const minutes =
            Math.floor(
                (totalSeconds % 3600) / 60
            );

        const seconds =
            totalSeconds % 60;

        if (hours > 0) {
            return `${hours} hr ${minutes} min ${seconds} sec`;
        }

        return `${minutes} min ${seconds} sec`;
    }


    function formatRupees(value) {
        const amount = Number(value);

        if (Number.isNaN(amount)) {
            return "Rs 0.00";
        }

        return `Rs ${amount.toFixed(2)}`;
    }


    function formatPaymentMethod(value) {
        if (!value) {
            return "Not required";
        }

        if (value === "card") {
            return "Card";
        }

        if (value === "cash") {
            return "Cash";
        }

        return value;
    }




    async function loadAdminSettings() {
        if (garageAuthFailedRef.current) return false;
        try {
            const result = await getGarageSettings();

            if (result?.success) {
                automaticEntryRef.current = Boolean(result.garage_settings?.automatic_entry);
                localImageSavingRef.current = Boolean(result.garage_settings?.local_image_saving);
                setAdminSettings(result);
                return true;
            }
        } catch (error) {
            if (error.status === 401) {
                garageAuthFailedRef.current = true;
                localStorage.removeItem("parking_admin_token");
                sessionStorage.removeItem("parking_admin_token");
                setGarageAuthFailed(true);
                return false;
            }
            console.error(
                "Could not load admin settings:",
                error
            );
        }
        return false;
    }


    async function loadParkingSpaces() {
        if (garageAuthFailedRef.current) return false;
        try {
            setParkingLoading(true);
            setParkingError("");

            const result =
                await getParkingSpaces();

            if (result.success) {
                const spaces = result.spaces || [];

                setParkingSpaces(spaces);
                parkingSpacesRef.current = spaces;
                return true;
            } else {
                setParkingError(
                    result.error ||
                    "Could not load parking spaces."
                );
            }

        } catch (error) {
            if (error.status === 401) {
                garageAuthFailedRef.current = true;
                localStorage.removeItem("parking_admin_token");
                sessionStorage.removeItem("parking_admin_token");
                setGarageAuthFailed(true);
                return false;
            }
            console.error(
                "Could not load parking spaces:",
                error
            );

            setParkingError(
                error.message ||
                "Could not load parking spaces."
            );

        } finally {
            setParkingLoading(false);
        }
    }


    // ============================================================
    // AUTOMATIC PARKING SPACE ASSIGNMENT
    // ============================================================

    function getAutomaticParkingSpace() {
        // Always start checking from the first parking space.
        // This means that when an earlier space becomes free after
        // a vehicle exits, the next vehicle will loop back and use
        // that earlier space before moving to later spaces.
        const spaces = [...parkingSpacesRef.current].sort(
            (a, b) => {
                const levelA = Number(a.level) || 0;
                const levelB = Number(b.level) || 0;

                if (levelA !== levelB) {
                    return levelA - levelB;
                }

                const numberA = Number(
                    String(a.space).match(/\d+/)?.[0] || 0
                );
                const numberB = Number(
                    String(b.space).match(/\d+/)?.[0] || 0
                );

                return numberA - numberB;
            }
        );

        return (
            spaces.find(
                (space) => !space.is_occupied
            ) || null
        );
    }


    useEffect(() => {
        if (!cameraActive) {
            return;
        }

        let cancelled = false;
        let nextFrameTimer;
        const processLatestFrame = async () => {
            const processed = await processCameraFrame(videoRef, true, "entry-1");
            if (!cancelled) {
                nextFrameTimer = window.setTimeout(
                    processLatestFrame,
                    processed ? VISION_REQUEST_INTERVAL_MS : 100
                );
            }
        };

        void processLatestFrame();

        return () => {
            cancelled = true;
            window.clearTimeout(nextFrameTimer);
        };
    }, [cameraActive]);


    useEffect(() => {
        if (!exitCameraActive) {
            return;
        }

        if (
            exitVideoRef.current &&
            exitStreamRef.current
        ) {
            exitVideoRef.current.srcObject =
                exitStreamRef.current;

            exitVideoRef.current
                .play()
                .catch(() => { });
        }

        let cancelled = false;
        let nextFrameTimer;
        const processLatestFrame = async () => {
            const processed = await processCameraFrame(exitVideoRef, true, "exit-1");
            if (!cancelled) {
                nextFrameTimer = window.setTimeout(
                    processLatestFrame,
                    processed ? VISION_REQUEST_INTERVAL_MS : 100
                );
            }
        };

        void processLatestFrame();

        return () => {
            cancelled = true;
            window.clearTimeout(nextFrameTimer);
        };
    }, [exitCameraActive]);


    useEffect(() => {
        const loadGarage = async () => {
            if (await loadAdminSettings()) {
                await loadParkingSpaces();
            }
        };
        void loadGarage();
        const interval = window.setInterval(() => {
            if (!garageAuthFailedRef.current) void loadParkingSpaces();
        }, 5000);
        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => {
        const handleSettingsUpdate = (event) => {
            if (event.key === GARAGE_SETTINGS_UPDATED_KEY && event.newValue) {
                void loadAdminSettings();
                setShowSettingsReloadNotice(true);
            }
        };
        window.addEventListener("storage", handleSettingsUpdate);
        return () => window.removeEventListener("storage", handleSettingsUpdate);
    }, []);

    useEffect(() => {
        const levels =
            adminSettings?.garage_settings?.levels || [];

        const levelIds = levels.map(
            (level) => Number(level.id)
        );

        if (
            levelIds.length > 0 &&
            !levelIds.includes(openLevel)
        ) {
            setOpenLevel(levelIds[0]);
        }
    }, [adminSettings, openLevel]);


    useEffect(() => () => {
        Object.keys(cameraStreamsRef.current).forEach(stopSlotCamera);
        Object.values(terminalClearTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    }, []);


    function handleSelectEntry() {
        setVehicleAction("entry");
        setEntryError("");
        setExitError("");
        setEntryResult(null);
        setExitResult(null);

        // Recalculate the automatic space at the exact moment
        // the user confirms "Entry Vehicle".
        // This guarantees that the latest occupied/available state
        // is used, including spaces after L1:02.
        const automaticSpace =
            getAutomaticParkingSpace();

        if (automaticSpace) {
            setSelectedSpaceId(
                automaticSpace.id
            );
        } else {
            setSelectedSpaceId(null);
            setEntryError(
                "No parking space is available for this vehicle."
            );
        }
    }


    async function startAutomaticExit(plate, source) {
        if (
            !source.startsWith("exit-") ||
            automaticExitAttemptRef.current[source] === plate ||
            exitSubmittingRef.current[source]
        ) {
            return;
        }

        automaticExitAttemptRef.current[source] = plate;

        pendingAutomaticExitRef.current[source] = { plate: "", source };

        // Do not start exit UI until backend confirms
        // that this vehicle is actually parked.
        updateCameraVehicleState(source, {
            action: null,
            loading: true,
            error: "",
            entryResult: null,
            exitResult: null,
            selectedSpaceId: null,
            paymentMethod: null,
            paymentRequired: false,
            ratePerMinute: null,
        });

        try {
            const result =
                await getPrefetchedExitPaymentRequired(plate, source);

            // Backend confirmed active parking session.
            const paymentRequired =
                Boolean(result.payment_required);

            updateCameraVehicleState(source, {
                action: "exit",
                loading: true,
                paymentRequired,
                ratePerMinute: result.rate_per_minute ?? 1.67,
            });

            const allowedMethods = [
                adminSettings?.billing_config?.payments_enabled && adminSettings?.billing_config?.cash_enabled
                && "cash",

                adminSettings?.billing_config?.payments_enabled && adminSettings?.billing_config?.card_enabled
                && "card",
            ].filter(Boolean);

            if (!paymentRequired) {

                await handleConfirmExit(
                    null,
                    false,
                    plate,
                    source
                );

            } else if (allowedMethods.length === 1) {

                const method =
                    allowedMethods[0];

                updateCameraVehicleState(source, { paymentMethod: method });

                await handleConfirmExit(
                    method,
                    true,
                    plate,
                    source
                );

            } else {

                pendingAutomaticExitRef.current[source] = {
                    plate,
                    source,
                };

                updateCameraVehicleState(source, { loading: false });
            }

        } catch (error) {

            if (error.status === 404) {

                console.log(
                    "[Exit blocked - vehicle not parked]",
                    {
                        plate,
                        source,
                    }
                );

                // Important:
                // allow this same plate to be checked again
                // after it leaves the camera and returns.
                if (
                    automaticExitAttemptRef.current[source]
                    === plate
                ) {
                    delete automaticExitAttemptRef.current[
                        source
                    ];
                }

                // Clear any cached exit check for this plate.
                if (exitPaymentPrefetchRef.current[source]?.plate === plate) {
                    delete exitPaymentPrefetchRef.current[source];
                }

                // Keep plate visible but completely block exit.
                updateCameraVehicleState(source, {
                    action: null,
                    error: "This vehicle is not parked in the garage.",
                    paymentMethod: null,
                    paymentRequired: false,
                    ratePerMinute: null,
                    loading: false,
                });
                delete pendingAutomaticExitRef.current[source];

                return;
            }

            console.error(
                "Exit status check failed:",
                error
            );

            if (
                automaticExitAttemptRef.current[source]
                === plate
            ) {
                delete automaticExitAttemptRef.current[
                    source
                ];
            }

            if (exitPaymentPrefetchRef.current[source]?.plate === plate) {
                delete exitPaymentPrefetchRef.current[source];
            }

            updateCameraVehicleState(source, {
                action: null,
                error: error.message || "Could not check vehicle parking status.",
                paymentMethod: null,
                paymentRequired: false,
                ratePerMinute: null,
                loading: false,
            });
            delete pendingAutomaticExitRef.current[source];
        }
    }

    function handlePaymentSelection(method, source = detectionSource || activeDetectionSourceRef.current) {
        const pendingExit = pendingAutomaticExitRef.current[source];
        if (!pendingExit?.plate) return;
        updateCameraVehicleState(source, { paymentMethod: method, error: "" });
        void handleConfirmExit(
            method,
            true,
            pendingExit.plate,
            source
        );
    }

    function getPendingEntryCameraId() {
        if (
            activeEntryCameraId &&
            cameraVehicleState[activeEntryCameraId]?.plate &&
            cameraVehicleState[activeEntryCameraId]?.action === "entry"
        ) {
            return activeEntryCameraId;
        }

        const firstPendingEntry = Object.entries(cameraVehicleState)
            .find(([, state]) => state?.plate && state.action === "entry");

        return firstPendingEntry ? firstPendingEntry[0] : null;
    }

    function handleSpaceSelection(space, cameraId = null) {
        cameraId = cameraId || getPendingEntryCameraId();
        const cameraState = cameraId ? cameraVehicleState[cameraId] || {} : null;
        if (
            space.is_occupied ||
            (cameraId ? cameraState.loading : entryLoading) ||
            (cameraId ? cameraState.action !== "entry" : exitLoading) ||
            (!cameraId && vehicleAction !== "entry")
        ) {
            return;
        }

        if (cameraId) {
            updateCameraVehicleState(cameraId, {
                selectedSpaceId: space.id,
                error: "",
            });
        } else {
            setSelectedSpaceId(space.id);
            setEntryError("");
        }
    }


    async function handleConfirmEntry(plateOverride, spaceOverride, sourceOverride = activeDetectionSourceRef.current, automatic = false) {
        const cameraState = cameraVehicleState[sourceOverride] || {};
        const plate = plateOverride || cameraState.plate || detectedPlate;
        const trackingMode = adminSettings?.garage_settings?.mode === "tracking";
        const spaceId = trackingMode ? null : spaceOverride ?? cameraState.selectedSpaceId ?? selectedSpaceId;
        if (entrySubmittingRef.current[sourceOverride]) return;
        if (!plate) {
            updateCameraVehicleState(sourceOverride, {
                error: "No vehicle license plate has been detected.",
            });
            setEntryError(
                "No vehicle license plate has been detected."
            );
            return;
        }

        if (!trackingMode && !automatic && !spaceId) {
            updateCameraVehicleState(sourceOverride, {
                error: "No parking space is available for this vehicle.",
            });
            setEntryError(
                "No parking space is available for this vehicle."
            );
            return;
        }

        entrySubmittingRef.current[sourceOverride] = true;
        updateCameraVehicleState(sourceOverride, {
            loading: true,
            error: "",
            entryResult: null,
        });
        const previousCameraState = cameraVehicleState[sourceOverride] || {};
        const previousSpaces = parkingSpacesRef.current;

        if (!trackingMode) {
            const optimisticSpaces = parkingSpacesRef.current.map((space) =>
                space.id === spaceId
                    ? {
                        ...space,
                        is_occupied: true,
                        license_plate: plate,
                        entry_time: new Date().toISOString(),
                    }
                    : space
            );

            parkingSpacesRef.current = optimisticSpaces;
            setParkingSpaces(optimisticSpaces);
        }

        clearCameraVehicleState(sourceOverride);

        setActiveEntryCameraId((current) =>
            current === sourceOverride ? null : current
        );

        let entryCompleted = false;
        try {
            const result = trackingMode
                ? await registerEntry(plate, null)
                : automatic
                    ? await registerEntry(plate)
                    : await registerEntry(
                        plate,
                        spaceId
                    );

            if (
                detectedPlateRef.current[sourceOverride] !== plate ||
                confirmedPlateLockRef.current[sourceOverride] !== plate
            ) return;

            if (!result.success) {
                updateCameraVehicleState(sourceOverride, {
                    loading: false,
                    error: result.error || "Vehicle entry failed.",
                });
                setEntryError(
                    result.error ||
                    "Vehicle entry failed."
                );
                return;
            }

            const vehicle = result.vehicle;

            // Keep this plate blocked until
            // the camera no longer sees it.
            lastCompletedPlateRef.current[sourceOverride] = plate;
            completedLockActionRef.current[sourceOverride] = plate;
            saveConfirmedLockImageAfterAction(plate, sourceOverride);

            const enteredSpaceId = automatic
                ? vehicle.parking_space_id ?? vehicle.space_id ?? null
                : spaceId;
            const nextSpaces =
                parkingSpacesRef.current.map(
                    (space) => {
                        const enteredSpace = !trackingMode && (enteredSpaceId != null
                            ? space.id === enteredSpaceId
                            : automatic &&
                            Number(space.level) === Number(vehicle.level) &&
                            String(space.space) === String(vehicle.space));

                        return enteredSpace
                            ? {
                                ...space,
                                is_occupied: true,
                                license_plate: vehicle.license_plate,
                                entry_time: vehicle.entry_time,
                            }
                            : space;
                    }
                );

            if (!trackingMode && automatic) {
                parkingSpacesRef.current = nextSpaces;
                setParkingSpaces(nextSpaces);
            }
            entryCompleted = true;
            clearCompletedCameraPlate(sourceOverride);
            clearCameraVehicleState(sourceOverride);
            setActiveEntryCameraId((current) =>
                current === sourceOverride ? null : current
            );

            detectedPlateRef.current[sourceOverride] = "";
            setDetectedPlate("");
            setDetectionSource(null);

            plateCandidateRef.current = "";
            plateCandidateCountRef.current = 0;

            setVehicleAction(null);
            setSelectedSpaceId(null);
            setEntryLoading(false);

            // Sync the backend state in the background, but do not
            // block the success confirmation while it finishes.
            void loadParkingSpaces();

        } catch (error) {
            if (!trackingMode) {
                parkingSpacesRef.current = previousSpaces;
                setParkingSpaces(previousSpaces);
            }

            updateCameraVehicleState(sourceOverride, {
                ...previousCameraState,
                loading: false,
                error: error.message || "Vehicle entry failed.",
            });

            console.error(
                "Vehicle entry error:",
                error
            );

            setEntryError(
                error.message ||
                "Vehicle entry failed."
            );

        } finally {
            delete entrySubmittingRef.current[sourceOverride];
            if (!entryCompleted) {
                updateCameraVehicleState(sourceOverride, { loading: false });
            }
            setEntryLoading(false);
        }
    }


    async function handleConfirmExit(
        selectedPaymentMethod,
        paymentRequired,
        plateOverride,
        sourceOverride = activeDetectionSourceRef.current
    ) {
        const cameraState = cameraVehicleState[sourceOverride] || {};
        const plate = plateOverride || cameraState.plate || detectedPlate;
        const trackingMode = adminSettings?.garage_settings?.mode === "tracking";
        const chosenPaymentMethod = trackingMode ? null : selectedPaymentMethod ?? cameraState.paymentMethod ?? paymentMethod;
        const requiresPayment = trackingMode ? false : paymentRequired ?? cameraState.paymentRequired ?? exitPaymentRequired;
        if (exitSubmittingRef.current[sourceOverride]) return;
        if (!plate) {
            updateCameraVehicleState(sourceOverride, {
                error: "No vehicle license plate has been detected.",
            });
            setExitError(
                "No vehicle license plate has been detected."
            );
            return;
        }

        const normalizedPaymentMethod =
            chosenPaymentMethod === "cash" || chosenPaymentMethod === "card"
                ? chosenPaymentMethod
                : null;

        if (requiresPayment && !chosenPaymentMethod) {
            updateCameraVehicleState(sourceOverride, {
                error: "Please select cash or card payment.",
            });
            setExitError(
                "Please select cash or card payment."
            );
            return;
        }

        exitSubmittingRef.current[sourceOverride] = true;
        updateCameraVehicleState(sourceOverride, {
            loading: true,
            error: "",
        });

        let exitCompleted = false;
        try {
            const result =
                await exitUsingPlate(
                    plate,
                    requiresPayment ? normalizedPaymentMethod : null
                );

            if (
                detectedPlateRef.current[sourceOverride] !== plate ||
                confirmedPlateLockRef.current[sourceOverride] !== plate
            ) return;

            if (!result.success) {
                updateCameraVehicleState(sourceOverride, {
                    loading: false,
                    error: result.error || "Vehicle exit failed.",
                });
                setExitError(
                    result.error ||
                    "Vehicle exit failed."
                );
                return;
            }

            const receipt = result.vehicle;

            lastCompletedPlateRef.current[sourceOverride] = plate;
            completedLockActionRef.current[sourceOverride] = plate;
            saveConfirmedLockImageAfterAction(plate, sourceOverride);
            clearCompletedCameraPlate(sourceOverride);
            delete automaticExitAttemptRef.current[sourceOverride];
            delete pendingAutomaticExitRef.current[sourceOverride];

            const nextSpaces =
                parkingSpacesRef.current.map((space) => {
                    if (
                        space.is_occupied &&
                        space.license_plate === plate
                    ) {
                        return {
                            ...space,
                            is_occupied: false,
                            license_plate: null,
                            entry_time: null,
                        };
                    }

                    return space;
                });

            if (!trackingMode) {
                parkingSpacesRef.current = nextSpaces;
                setParkingSpaces(nextSpaces);
            }

            exitCompleted = true;
            clearCameraVehicleState(sourceOverride);
            clearCompletedCameraPlate(sourceOverride);

            detectedPlateRef.current[sourceOverride] = "";
            setDetectedPlate("");
            setDetectionSource(null);

            plateCandidateRef.current = "";
            plateCandidateCountRef.current = 0;

            setVehicleAction(null);
            setSelectedSpaceId(null);
            setPaymentMethod(null);
            setExitLoading(false);



        } catch (error) {
            console.error(
                "Vehicle exit error:",
                error
            );

            updateCameraVehicleState(sourceOverride, {
                loading: false,
                error: error.message || "Vehicle exit failed.",
            });
            setExitError(
                error.message ||
                "Vehicle exit failed."
            );

        } finally {
            delete exitSubmittingRef.current[sourceOverride];
            if (!exitCompleted) {
                updateCameraVehicleState(sourceOverride, { loading: false });
            }
            setExitLoading(false);
        }
    }


    const totalSpaces =
        parkingSpaces.length;

    const occupiedSpaces =
        parkingSpaces.filter(
            (space) => space.is_occupied
        ).length;

    const availableSpaces =
        totalSpaces - occupiedSpaces;

    const selectedSpace =
        parkingSpaces.find(
            (space) =>
                space.id === selectedSpaceId
        );

    const garageFull =
        totalSpaces > 0 &&
        availableSpaces === 0;


    function renderLevel(level) {
        const pendingEntryCameraId = getPendingEntryCameraId();
        const pendingEntryState = pendingEntryCameraId
            ? cameraVehicleState[pendingEntryCameraId] || {}
            : null;
        const spaces =
            parkingSpaces.filter(
                (space) =>
                    Number(space.level) ===
                    Number(level)
            );

        return (
            <div
                className="parking-level"
                key={level}
            >
                {openLevel === level && (
                    <div className="parking-grid">
                        {spaces.map((space) => {
                            const isSelected = pendingEntryState
                                ? pendingEntryState.selectedSpaceId === space.id
                                : selectedSpaceId === space.id;

                            const vehicle =
                                space.is_occupied
                                    ? {
                                        license_plate:
                                            space.license_plate,
                                        entry_time:
                                            space.entry_time,
                                    }
                                    : null;

                            return (
                                <button
                                    key={space.id}
                                    type="button"
                                    className={
                                        `parking-space ${space.is_occupied
                                            ? "occupied"
                                            : "available"
                                        } ${isSelected
                                            ? "selected"
                                            : ""
                                        }`
                                    }
                                    onClick={() =>
                                        handleSpaceSelection(
                                            space
                                        )
                                    }
                                    disabled={
                                        space.is_occupied ||
                                        (pendingEntryState
                                            ? pendingEntryState.loading || pendingEntryState.action !== "entry"
                                            : entryLoading || exitLoading || vehicleAction !== "entry")
                                    }
                                >
                                    <span className="parking-space-number">
                                        {space.space}
                                    </span>

                                    {space.is_occupied ? (
                                        vehicle ? (
                                            <div className="parking-space-vehicle">
                                                <strong>
                                                    {
                                                        vehicle.license_plate
                                                    }
                                                </strong>

                                                <small>
                                                    Entry:{" "}
                                                    {formatDateTime(
                                                        vehicle.entry_time
                                                    )}
                                                </small>
                                            </div>
                                        ) : (
                                            <small>
                                                Occupied
                                            </small>
                                        )
                                    ) : (
                                        <small>
                                            {isSelected
                                                ? "Selected"
                                                : "Available"}
                                        </small>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }


    function renderVehicleInformation() {
        if (exitResult) {
            return (
                <div className="vehicle-info-panel exit-info exit-receipt">
                    <div className="vehicle-info-header">
                        <span>
                            EXIT RECEIPT
                        </span>
                    </div>

                    <h3>
                        {exitResult.license_plate}
                    </h3>

                    <div className="vehicle-info-row">
                        <strong>
                            Entry Time
                        </strong>

                        <span>
                            {formatDateTime(
                                exitResult.entry_time
                            )}
                        </span>
                    </div>

                    <div className="vehicle-info-row">
                        <strong>
                            Exit Time
                        </strong>

                        <span>
                            {formatDateTime(
                                exitResult.exit_time
                            )}
                        </span>
                    </div>

                    <div className="vehicle-info-row">
                        <strong>
                            Duration
                        </strong>

                        <span>
                            {formatDuration(
                                exitResult.entry_time,
                                exitResult.exit_time
                            )}
                        </span>
                    </div>

                    <div className="vehicle-info-row">
                        <strong>
                            Rate
                        </strong>

                        <span>
                            {formatRupees(
                                exitResult.rate_per_minute ??
                                1.67
                            )}
                            {" / minute"}
                        </span>
                    </div>

                    <div className="vehicle-info-row">
                        <strong>
                            Parking Space
                        </strong>

                        <span>
                            Level{" "}
                            {exitResult.level}
                            {" — "}
                            {exitResult.space}
                        </span>
                    </div>

                    <div className="vehicle-info-row">
                        <strong>
                            Payment
                        </strong>

                        <span>
                            {formatPaymentMethod(
                                exitResult.payment_method
                            )}
                        </span>
                    </div>

                    {Number(exitResult.discount_percent) > 0 && (
                        <div className="vehicle-info-row">
                            <strong>
                                Whitelist Discount
                            </strong>

                            <span>
                                {exitResult.discount_percent}%
                            </span>
                        </div>
                    )}

                    <div className="vehicle-info-amount">
                        <span>
                            Amount Owed
                        </span>

                        <strong>
                            {formatRupees(
                                exitResult.amount
                            )}
                        </strong>
                    </div>

                    <button
                        type="button"
                        className="cancel-button receipt-done-button"
                        onClick={() =>
                            setExitResult(null)
                        }
                    >
                        Done
                    </button>
                </div>
            );
        }


        if (entryResult) {
            return (
                <div className="vehicle-info-panel entry-info">
                    <div className="vehicle-info-header">
                        <span>
                            ENTRY COMPLETED
                        </span>
                    </div>

                    <h3>
                        {entryResult.license_plate}
                    </h3>

                    <div className="vehicle-info-row">
                        <strong>
                            Entry Time
                        </strong>

                        <span>
                            {formatDateTime(
                                entryResult.entry_time
                            )}
                        </span>
                    </div>

                    <div className="vehicle-info-row">
                        <strong>
                            Parking Space
                        </strong>

                        <span>
                            Level{" "}
                            {entryResult.level}
                            {" — "}
                            {entryResult.space}
                        </span>
                    </div>

                    <div className="vehicle-info-row">
                        <strong>
                            Status
                        </strong>

                        <span>
                            Vehicle Parked
                        </span>
                    </div>
                </div>
            );
        }


        if (detectedPlate) {
            return (
                <div className="vehicle-info-panel detected-info">
                    <div className="vehicle-info-header">
                        <span>
                            VEHICLE DETECTED
                        </span>
                    </div>

                    <h3>
                        {detectedPlate}
                    </h3>

                    <div className="vehicle-info-row">
                        <strong>
                            Action
                        </strong>

                        <span>
                            {vehicleAction === "entry"
                                ? "Entry"
                                : vehicleAction ===
                                    "exit"
                                    ? "Exit"
                                    : "Awaiting selection"}
                        </span>
                    </div>

                    {vehicleAction === "entry" && (
                        <div className="vehicle-info-row">
                            <strong>
                                Parking Space
                            </strong>

                            <span>
                                {selectedSpace
                                    ? `Level ${selectedSpace.level} — ${selectedSpace.space}`
                                    : "Not selected"}
                            </span>
                        </div>
                    )}
                </div>
            );
        }


        return (
            <div className="vehicle-info-panel empty-info">
                <div className="camera-icon">
                    📷
                </div>

                <strong>
                    No vehicle information
                </strong>

                <p>
                    Vehicle information will appear
                    here when a vehicle is detected.
                </p>
            </div>
        );
    }

    void renderVehicleInformation;

    const configuredEntryCameraCount = Math.min(4, Math.max(
        1,
        Number(adminSettings?.camera_config?.entry_lane_cameras) || 1
    ));
    const configuredExitCameraCount = Math.min(4, Math.max(
        1,
        Number(adminSettings?.camera_config?.exit_lane_cameras) || 1
    ));
    // Backend validation prevents this case; retain this guard for old or malformed saved settings.
    const entryCameraCount = configuredEntryCameraCount;
    const exitCameraCount = Math.min(configuredExitCameraCount, Math.max(0, 4 - entryCameraCount));
    function renderSharedCamera(cameraId, label, streamRef, isActive) {
        return (
            <div className="camera-panel" key={cameraId} data-camera-id={cameraId}>
                <div className="camera-panel-header">
                    <div>
                        <span className="camera-kicker">{cameraId}</span>
                        <strong>{label}</strong>
                    </div>
                </div>
                <div className="camera-preview">
                    <span className={`camera-feed-status camera-status ${isActive ? "active" : "standby"
                        }`}>
                        {isActive ? "Live" : "Standby"}
                    </span>
                    {isActive ? (
                        <video
                            autoPlay
                            playsInline
                            muted
                            ref={(node) => {
                                if (node && streamRef.current?.srcObject) {
                                    node.srcObject = streamRef.current.srcObject;
                                }
                            }}
                        />
                    ) : (
                        <div className="camera-standby">
                            <strong>Camera is closed</strong>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const cameraSlots = [
        ...Array.from({ length: entryCameraCount }, (_, index) => ({ id: `entry-${index + 1}`, label: `Entry Camera ${index + 1}`, lane: "Entry" })),
        ...Array.from({ length: exitCameraCount }, (_, index) => ({ id: `exit-${index + 1}`, label: `Exit Camera ${index + 1}`, lane: "Exit" })),
    ];

    function stopSlotCamera(cameraId) {
        cameraRequestsRef.current[cameraId] = false;
        window.clearTimeout(cameraTimersRef.current[cameraId]);
        delete cameraTimersRef.current[cameraId];
        cameraStreamsRef.current[cameraId]?.getTracks().forEach((track) => track.stop());
        delete cameraStreamsRef.current[cameraId];
    }

    async function startSlotCamera(cameraId) {

        const deviceId = cameraAssignments[cameraId];
        const video = cameraNodesRef.current[cameraId];
        if (!deviceId || !video || cameraStreamsRef.current[cameraId] || cameraStartingRefBySlot.current[cameraId]) return;
        cameraStartingRefBySlot.current[cameraId] = true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });


            cameraStreamsRef.current[cameraId] = stream;
            video.srcObject = stream;
            await video.play();
            setCameraViews((current) => ({ ...current, [cameraId]: { active: true, error: "", box: null } }));
            runSlotDetection(cameraId);
        } catch (error) {
            setCameraViews((current) => ({ ...current, [cameraId]: { active: false, error: error.message || "Could not access camera." } }));
        } finally {
            cameraStartingRefBySlot.current[cameraId] = false;
        }
    }

    async function runSlotDetection(cameraId) {

        const laneGeneration = cameraLaneGenerationRef.current;
        const video = cameraNodesRef.current[cameraId];
        if (!cameraStreamsRef.current[cameraId] || !video || cameraRequestsRef.current[cameraId]) return;
        cameraRequestsRef.current[cameraId] = true;
        const canvas = cameraCanvasesRef.current[cameraId] || document.createElement("canvas");
        cameraCanvasesRef.current[cameraId] = canvas;
        try {
            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                const result = await multiCameraTestSchedulerRef.current.schedule(
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
                );
                if (cameraStreamsRef.current[cameraId]) {
                    setCameraViews((current) => {
                        const currentView = current[cameraId] || {};
                        if (currentView.active && boxesEqual(currentView.box, result.box)) return current;
                        return { ...current, [cameraId]: { ...currentView, active: true, box: result.box || null } };
                    });
                    const plate = result.license_plate?.trim().toUpperCase();
                    const lockedPlate = confirmedPlateLockRef.current[cameraId];

                    if (lockedPlate && plate === lockedPlate) {
                        detectedPlateRef.current[cameraId] = lockedPlate;


                        return;
                    }

                    // Per-camera temporal confirmation and lock.
                    {
                        const now = Date.now();
                        if (result.detected) {
                            confirmedPlateLastDetectedAtRef.current[cameraId] = now;
                        }

                        if (plate) {
                            const rawConfidence = Number(result.confidence || 0);
                            const normalizedConfidence =
                                rawConfidence > 1
                                    ? rawConfidence / 100
                                    : rawConfidence;

                            if (normalizedConfidence < MIN_VOTING_CONFIDENCE) {
                                return;
                            }

                            const voteState =
                                plateVoteHistoryRef.current[cameraId] || {
                                    reads: [],
                                    lastSeenAt: 0,
                                };

                            if (
                                !MULTI_CAMERA_ORCHESTRATION_TEST &&
                                voteState.lastSeenAt &&
                                now - voteState.lastSeenAt > 2500
                            ) {
                                voteState.reads = [];
                            }
                            voteState.lastSeenAt = now;
                            voteState.reads.push({
                                plate,
                                confidence: normalizedConfidence,
                            });
                            voteState.reads = voteState.reads.slice(-5);
                            plateVoteHistoryRef.current[cameraId] = voteState;
                            // PARTIAL_PLATE_LOCK_GUARD_V3
                            // Keep a separate short-lived evidence history.
                            // Voting still uses ONLY the latest 5 reads.
                            const evidenceState =
                                partialPlateEvidenceRef.current[cameraId] || [];

                            evidenceState.push({
                                plate,
                                confidence: normalizedConfidence,
                                seenAt: now,
                            });

                            partialPlateEvidenceRef.current[cameraId] =
                                evidenceState
                                    .filter(
                                        (read) =>
                                            now - read.seenAt <=
                                            PARTIAL_GUARD_EVIDENCE_TTL_MS
                                    )
                                    .slice(-20);

                            const voteCounts = {};
                            for (const read of voteState.reads) {
                                voteCounts[read.plate] =
                                    (voteCounts[read.plate] || 0) + 1;
                            }

                            const bestVote = Object.entries(voteCounts)
                                .sort((a, b) => b[1] - a[1])[0];

                            const bestPlate = bestVote?.[0] || plate;
                            const bestCount = bestVote?.[1] || 1;

                            const bestPlateReads = voteState.reads.filter(
                                (read) => read.plate === bestPlate
                            );
                            const veryHighConfidenceMatches =
                                bestPlateReads.filter(
                                    (read) =>
                                        read.confidence >= VERY_HIGH_OCR_CONFIDENCE
                                ).length;
                            const mediumConfidenceMatches =
                                bestPlateReads.filter(
                                    (read) =>
                                        read.confidence >= MEDIUM_OCR_CONFIDENCE
                                ).length;

                            const normalizedBest = bestPlate
                                .replace(/[^A-Z0-9]/gi, "")
                                .toUpperCase();
                            // CUSTOM_SHORT_PLATE_TIER_V2
                            // Legit premium/custom numeric plates (1, 2, 001, 007, 100)
                            // are allowed, but require stronger evidence than normal plates.
                            const isCustomShortCandidate =
                                /^\d{1,4}$/.test(normalizedBest);

                            let requiredVotesForCandidate = 4;
                            let adaptiveReason = "fallback-4";

                            if (
                                !isCustomShortCandidate &&
                                veryHighConfidenceMatches >= 2
                            ) {
                                requiredVotesForCandidate = 2;
                                adaptiveReason = "very-high-2";
                            } else if (
                                !isCustomShortCandidate &&
                                mediumConfidenceMatches >= 3
                            ) {
                                requiredVotesForCandidate = 3;
                                adaptiveReason = "medium-3";
                            }

                            console.log("[Vision confirming]", {
                                source: cameraId,
                                incoming: plate,
                                reads: voteState.reads.map((read) => read.plate),
                                bestPlate,
                                bestCount,
                                requiredVotes: requiredVotesForCandidate,
                                adaptiveReason,
                                veryHighConfidenceMatches,
                                mediumConfidenceMatches,
                                windowSize: 5,
                            });
                            // PARTIAL_PLATE_LOCK_GUARD_V2
                            const compatibleLongerEvidence =
                                (
                                    partialPlateEvidenceRef.current[cameraId] || []
                                )
                                    .filter((read) => {
                                        if (!read?.plate) return false;

                                        const normalizedCandidate = read.plate
                                            .replace(/[^A-Z0-9]/gi, "")
                                            .toUpperCase();

                                        if (
                                            normalizedCandidate.length <=
                                            normalizedBest.length
                                        ) {
                                            return false;
                                        }

                                        const directExtension =
                                            normalizedCandidate.startsWith(normalizedBest) ||
                                            normalizedCandidate.endsWith(normalizedBest);

                                        let shortIndex = 0;

                                        for (const ch of normalizedCandidate) {
                                            if (
                                                shortIndex < normalizedBest.length &&
                                                ch === normalizedBest[shortIndex]
                                            ) {
                                                shortIndex += 1;
                                            }
                                        }

                                        const orderedExtension =
                                            shortIndex === normalizedBest.length;

                                        return directExtension || orderedExtension;
                                    });

                            const compatibleLongerGroups = {};

                            for (const read of compatibleLongerEvidence) {
                                const key = read.plate
                                    .replace(/[^A-Z0-9]/gi, "")
                                    .toUpperCase();

                                if (!compatibleLongerGroups[key]) {
                                    compatibleLongerGroups[key] = {
                                        plate: read.plate,
                                        count: 0,
                                        maxConfidence: 0,
                                    };
                                }

                                compatibleLongerGroups[key].count += 1;

                                compatibleLongerGroups[key].maxConfidence =
                                    Math.max(
                                        compatibleLongerGroups[key].maxConfidence,
                                        Number(read.confidence || 0)
                                    );
                            }

                            const strongLongerEvidence =
                                Object.values(compatibleLongerGroups)
                                    .sort((a, b) => {
                                        if (b.count !== a.count) {
                                            return b.count - a.count;
                                        }

                                        return b.maxConfidence - a.maxConfidence;
                                    })
                                    .find(
                                        (candidate) =>
                                            candidate.count >= 2 ||
                                            candidate.maxConfidence >=
                                            PARTIAL_GUARD_STRONG_CONFIDENCE
                                    );

                            const longerCompatiblePlate =
                                strongLongerEvidence?.plate || null;
                            const candidateKey = `${cameraId}:${bestPlate}`;

                            if (!plateCandidateFirstSeenRef.current[candidateKey]) {
                                plateCandidateFirstSeenRef.current[candidateKey] = now;
                            }

                            const candidateAgeMs =
                                now -
                                plateCandidateFirstSeenRef.current[candidateKey];

                            const requiredAgeMsForCandidate =
                                isCustomShortCandidate ? 1200 : 700;
                            const matureEnough =
                                candidateAgeMs >= requiredAgeMsForCandidate;

                            if (
                                bestCount >= requiredVotesForCandidate &&
                                matureEnough &&
                                !longerCompatiblePlate
                            ) {
                                if (lastCompletedPlateRef.current[cameraId] !== bestPlate) {
                                    delete lastCompletedPlateRef.current[cameraId];
                                }
                                confirmedPlateLockRef.current[cameraId] = bestPlate;
                                confirmedPlateLastDetectedAtRef.current[cameraId] = now;
                                detectedPlateRef.current[cameraId] = bestPlate;

                                updateCameraVehicleState(cameraId, {
                                    plate: bestPlate,
                                    action: null,
                                    loading: true,
                                    error: "",
                                    alreadyParked: false,
                                    selectedSpaceId: null,
                                    entryResult: null,
                                    exitResult: null,
                                    paymentRequired: false,
                                    paymentMethod: null,
                                    ratePerMinute: null,
                                });

                                confirmedLockImageRef.current[cameraId] = canvas.toDataURL("image/jpeg", 0.82);
                                console.log("[Vision confirmed lock]", {
                                    source: cameraId,
                                    plate: bestPlate,
                                    bestCount,
                                    requiredVotes: requiredVotesForCandidate,
                                    windowSize: 5,
                                    partialGuard: true,
                                    customShortCandidate: isCustomShortCandidate,
                                    requiredAgeMs: requiredAgeMsForCandidate,
                                    candidateAgeMs,
                                });

                                void resolveConfirmedCameraPlate(
                                    cameraId,
                                    bestPlate,
                                    canvas.toDataURL("image/jpeg", 0.82)
                                );

                            } else if (
                                bestCount >= requiredVotesForCandidate &&
                                (!matureEnough || longerCompatiblePlate)
                            ) {
                                console.log("[Vision partial guard]", {
                                    source: cameraId,
                                    plate: bestPlate,
                                    bestCount,
                                    requiredVotes: requiredVotesForCandidate,
                                    customShortCandidate: isCustomShortCandidate,
                                    requiredAgeMs: requiredAgeMsForCandidate,
                                    candidateAgeMs,
                                    matureEnough,
                                    longerCompatiblePlate: longerCompatiblePlate || null,
                                });
                            }
                        }
                    }
                }
            }
        } catch (error) {
            if (VISION_DEBUG) console.debug("Vision processing error:", error);
        } finally {
            cameraRequestsRef.current[cameraId] = false;
            if (cameraStreamsRef.current[cameraId]) {
                cameraTimersRef.current[cameraId] = window.setTimeout(
                    () => runSlotDetection(cameraId),
                    VISION_REQUEST_INTERVAL_MS
                );
            }
        }
    }

    function renderCameraVehicleAction(cameraId, vehicleState) {
        const trackingMode = adminSettings?.garage_settings?.mode === "tracking";
        const selectedCameraSpace = trackingMode
            ? null
            : parkingSpaces.find(
                (space) => space.id === vehicleState.selectedSpaceId
            );
        const isExit = cameraId.startsWith("exit-");
        const isParked = !trackingMode && parkingSpaces.some(
            (space) => space.is_occupied && space.license_plate === vehicleState.plate
        );
        const showPaymentSelection = isExit && isParked && vehicleState.paymentRequired &&
            Boolean(adminSettings?.billing_config?.payments_enabled &&
                adminSettings?.billing_config?.cash_enabled &&
                adminSettings?.billing_config?.card_enabled);

        if (!vehicleState.plate) return null;

        return (
            <div
                className="camera-vehicle-actions"
                onClick={() => {
                    if (
                        cameraId.startsWith("entry-") &&
                        vehicleState.action === "entry"
                    ) {
                        setActiveEntryCameraId(cameraId);
                    }
                }}
            >
                {vehicleState.alreadyParked && <div className="error">Vehicle is already parked in the garage.</div>}
                {vehicleState.error && <div className="error">{vehicleState.error}</div>}
                {vehicleState.loading && !vehicleState.action && <p className="description">Checking vehicle status...</p>}

                {vehicleState.action === "entry" && !vehicleState.loading && (
                    <div className="entry-mode">
                        <h3>{trackingMode ? "Log Vehicle Entry" : "Select Parking Space"}</h3>
                        {!trackingMode && <div className="selected-space-info">
                            <strong>Selected Space:</strong>
                            <span>{selectedCameraSpace ? `Level ${selectedCameraSpace.level} - ${selectedCameraSpace.space}` : "No space available"}</span>
                        </div>}
                        <div className="confirmation-buttons">
                            <button
                                type="button"
                                className="confirm-button"
                                onClick={() => handleConfirmEntry(vehicleState.plate, trackingMode ? null : vehicleState.selectedSpaceId, cameraId)}
                                disabled={vehicleState.loading || (!trackingMode && !vehicleState.selectedSpaceId)}
                            >
                                {trackingMode ? "Log Entry" : "Confirm Entry"}
                            </button>
                        </div>
                    </div>
                )}

                {isExit && vehicleState.action === "exit" && !vehicleState.loading && (
                    <div className="exit-mode">
                        <h3>{trackingMode ? "Log Vehicle Exit" : "Exit Vehicle"}</h3>
                        <p className="description">
                            {trackingMode ? "Vehicle is currently logged." : vehicleState.paymentRequired
                                ? `Select a payment method. Parking is billed at ${formatRupees(vehicleState.ratePerMinute ?? 1.67)} per minute.`
                                : "Exit is being processed automatically."}
                        </p>
                        {trackingMode ? (
                            <button type="button" className="confirm-button" onClick={() => handleConfirmExit(null, false, vehicleState.plate, cameraId)}>
                                Log Exit
                            </button>
                        ) : showPaymentSelection && (
                            <div className="payment-options">
                                {(["cash", "card"]).map((method) => (
                                    <button
                                        type="button"
                                        key={method}
                                        className={`payment-option ${vehicleState.paymentMethod === method ? "selected" : ""}`}
                                        onClick={() => handlePaymentSelection(method, cameraId)}
                                        disabled={vehicleState.loading}
                                    >
                                        <span>{method === "cash" ? "Cash" : "Card"}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        {vehicleState.loading && <p className="description">Processing Exit...</p>}
                    </div>
                )}
            </div>
        );
    }

    function renderSlotCamera(slot) {
        const view = cameraViews[slot.id] || {};
        const vehicleState = cameraVehicleState[slot.id] || {};
        const assigned = Boolean(cameraAssignments[slot.id]);
        const isActiveLane = true;
        return <div className="camera-panel" key={slot.id}>
            <div className="camera-panel-header"><div><span className="camera-kicker">{slot.id}</span><strong>{slot.label}</strong></div></div>
            <div className="camera-preview">
                {assigned && <span className={`camera-feed-status camera-status ${isActiveLane && view.active ? "active" : "standby"}`}>{isActiveLane && view.active ? "Live" : "Standby"}</span>}
                {!assigned ? <div className="camera-standby"><strong>Camera not assigned</strong></div> : !isActiveLane ? <div className="camera-standby"><strong>{slot.lane} cameras are on standby</strong></div> : <><video ref={(node) => { cameraNodesRef.current[slot.id] = node; if (node) void startSlotCamera(slot.id); }} autoPlay playsInline muted />{renderDetectionBox(view.box, { current: cameraNodesRef.current[slot.id] })}</>}
            </div>
            {view.error && <div className="error">{view.error}</div>}
            <VehicleInformation
                exitResult={vehicleState.exitResult}
                entryResult={vehicleState.entryResult}
                detectedPlate={vehicleState.plate}
                vehicleAction={vehicleState.action}
                selectedSpace={parkingSpaces.find((space) => space.id === vehicleState.selectedSpaceId)}
                trackingMode={adminSettings?.garage_settings?.mode === "tracking"}
                onReceiptDone={() => updateCameraVehicleState(slot.id, { exitResult: null })}
            />
            {renderCameraVehicleAction(slot.id, vehicleState)}
        </div>;
    }

    function switchActiveLane() {
        const nextLane = activeLane === "entry" ? "exit" : "entry";
        cameraLaneGenerationRef.current += 1;
        cameraSlots.filter((slot) => slot.lane.toLowerCase() === activeLane).forEach((slot) => stopSlotCamera(slot.id));
        clearVehicleDetectionState();
        activeLaneRef.current = nextLane;
        setActiveLane(nextLane);
    }


    const billingConfig = adminSettings?.billing_config;
    const isDetectedVehicleParked = parkingSpaces.some(
        (space) => space.is_occupied && space.license_plate === detectedPlate
    );
    const showPaymentSelection = isDetectedVehicleParked && exitPaymentRequired && Boolean(
        billingConfig?.payments_enabled && billingConfig?.cash_enabled && billingConfig?.card_enabled
    );
    const showCashPayment = showPaymentSelection;
    const showCardPayment = showPaymentSelection;
    const lockActionAlreadyCompleted = Boolean(
        detectionSource && completedLockActionRef.current[detectionSource] === detectedPlate
    );

    return (
        <div className="app">
            {showSettingsReloadNotice && (
                <div className="settings-reload-notice" role="status">
                    <span>Admin changes applied. Reload Garage to use the latest configuration.</span>
                    <button type="button" onClick={() => window.location.reload()}>Reload</button>
                    <button type="button" onClick={() => setShowSettingsReloadNotice(false)}>Dismiss</button>
                </div>
            )}
            {garageAuthFailed && <div className="settings-reload-notice" role="alert">Your admin session has expired. <a href="/admin">Sign in again</a></div>}
            <header className="header">
                <div>
                    <h1>
                        ParkingOS
                    </h1>

                    <div className="garage-header-controls"><button type="button" className="garage-admin-link" onClick={() => openOrFocusNamedTab("/admin", "parkingos-admin")}>Open Admin</button></div>

                    <p>
                        Parking
                        Management System
                    </p>
                </div>
            </header>


            <main className="container">

                <section className="card parking-status">
                    <h2>
                        Parking Status
                    </h2>

                    <p className="description">
                        Current parking garage occupancy.
                    </p>

                    {parkingLoading &&
                        parkingSpaces.length === 0 && (
                            <div className="status-message">
                                Loading parking status...
                            </div>
                        )}

                    {parkingError && (
                        <div className="error">
                            {parkingError}
                        </div>
                    )}

                    {parkingSpaces.length > 0 && (
                        <>
                            <div className="parking-summary">
                                <div
                                    className={
                                        `space-status ${garageFull
                                            ? "unavailable"
                                            : "available"
                                        }`
                                    }
                                >
                                    <span className="status-indicator">
                                        ●
                                    </span>

                                    <div>
                                        <strong>
                                            {garageFull
                                                ? "Parking Full"
                                                : `${availableSpaces} Spaces Available`}
                                        </strong>

                                        <p>
                                            {occupiedSpaces}{" "}
                                            of{" "}
                                            {totalSpaces}{" "}
                                            spaces occupied
                                        </p>
                                    </div>
                                </div>
                            </div>


                            <div className="parking-legend">
                                <div>
                                    <span className="legend-box available-box" />
                                    Available
                                </div>

                                <div>
                                    <span className="legend-box occupied-box" />
                                    Occupied
                                </div>

                                <div>
                                    <span className="legend-box selected-box" />
                                    Selected
                                </div>
                            </div>

                            <div className="level-tabs" role="tablist">
                                {[
                                    ...new Set(
                                        parkingSpaces.map(
                                            (space) => Number(space.level)
                                        )
                                    ),
                                ]
                                    .sort((a, b) => a - b)
                                    .map((level) => (
                                        <button
                                            key={level}
                                            type="button"
                                            className={`level-toggle ${openLevel === level
                                                ? "active"
                                                : ""
                                                }`}
                                            onClick={() => setOpenLevel(level)}
                                            role="tab"
                                            aria-selected={openLevel === level}
                                        >
                                            Level {level}
                                        </button>
                                    ))}
                            </div>

                            {openLevel && renderLevel(openLevel)}
                        </>
                    )}
                </section>


                <section className="vehicle-section">

                    <section className="card entry-card">

                        <h2>
                            Vehicle Detection
                        </h2>

                        <p className="description">
                            The camera automatically detects the
                            vehicle's license plate.
                        </p>


                        <div className="camera-lane-groups">
                            <section><p className="camera-kicker">Entry</p><div className="camera-slot-grid">{cameraSlots.filter((slot) => slot.lane === "Entry").map(renderSlotCamera)}</div></section>
                            <section><p className="camera-kicker">Exit</p><div className="camera-slot-grid">{cameraSlots.filter((slot) => slot.lane === "Exit").map(renderSlotCamera)}</div></section>
                        </div>


                        <div className="camera-grid legacy-camera-grid">

                            <div className="camera-panel">

                                <div className="camera-panel-header">
                                    <div>
                                        <span className="camera-kicker">
                                            Lane 01
                                        </span>

                                        <strong>
                                            Entry Camera 1
                                        </strong>
                                    </div>

                                </div>


                                <div className="camera-preview">
                                    <span
                                        className={`camera-feed-status camera-status ${cameraActive
                                            ? "active"
                                            : "standby"
                                            }`}
                                    >
                                        {cameraActive ? (
                                            <>
                                                <span className="live-dot">●</span>
                                                {" Live"}
                                            </>
                                        ) : (
                                            "Standby"
                                        )}
                                    </span>

                                    {renderDetectionBox(
                                        entryDetectionBox,
                                        videoRef
                                    )}

                                    {exitCameraActive ? (
                                        <div className="camera-standby">
                                            <span className="camera-icon">▣</span>
                                            <strong>Entry camera is closed</strong>
                                            <p>Close the exit camera to resume entry monitoring.</p>
                                        </div>
                                    ) : (
                                        <video
                                            ref={videoRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            onCanPlay={(event) =>
                                                event.currentTarget
                                                    .play()
                                                    .catch(
                                                        () => { }
                                                    )
                                            }
                                        />
                                    )}
                                </div>

                            </div>

                            {Array.from({ length: entryCameraCount - 1 }, (_, index) =>
                                renderSharedCamera(
                                    `entry-${index + 2}`,
                                    `Entry Camera ${index + 2}`,
                                    videoRef,
                                    cameraActive && !exitCameraActive
                                )
                            )}


                            <div className="camera-panel">

                                <div className="camera-panel-header">
                                    <div>
                                        <span className="camera-kicker">
                                            Lane 02
                                        </span>

                                        <strong>
                                            Exit Camera 1
                                        </strong>
                                    </div>

                                </div>


                                <div className="camera-preview exit-camera-preview">
                                    <span
                                        className={`camera-feed-status camera-status ${exitCameraActive
                                            ? "active"
                                            : "standby"
                                            }`}
                                    >
                                        {exitCameraActive ? (
                                            <>
                                                <span className="live-dot">●</span>
                                                {" Live"}
                                            </>
                                        ) : (
                                            "Standby"
                                        )}
                                    </span>

                                    {renderDetectionBox(
                                        exitDetectionBox,
                                        exitVideoRef
                                    )}

                                    {exitCameraActive ? (
                                        <video
                                            ref={exitVideoRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            onCanPlay={(event) =>
                                                event.currentTarget
                                                    .play()
                                                    .catch(
                                                        () => { }
                                                    )
                                            }
                                        />
                                    ) : (
                                        <div className="camera-standby">
                                            <span className="camera-icon">
                                                ▣
                                            </span>

                                            <strong>
                                                Exit camera is closed
                                            </strong>

                                            <p>
                                                Open it when a vehicle
                                                is leaving.
                                            </p>
                                        </div>
                                    )}

                                </div>


                                {!exitCameraActive ? (
                                    <button
                                        type="button"
                                        className="open-camera-button"
                                        onClick={
                                            openExitCamera
                                        }
                                    >
                                        Open Exit Camera
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className="close-camera-button"
                                        onClick={
                                            closeExitCamera
                                        }
                                    >
                                        Close Exit Camera
                                    </button>
                                )}


                                {exitCameraError && (
                                    <div className="error">
                                        {exitCameraError}
                                    </div>
                                )}

                            </div>

                            {Array.from({ length: exitCameraCount - 1 }, (_, index) =>
                                renderSharedCamera(
                                    `exit-${index + 2}`,
                                    `Exit Camera ${index + 2}`,
                                    exitVideoRef,
                                    exitCameraActive
                                )
                            )}

                        </div>


                        <canvas
                            ref={canvasRef}
                            style={{
                                display: "none",
                            }}
                        />


                        {cameraError && (
                            <div className="error">
                                {cameraError}
                            </div>
                        )}


                        {false && !detectedPlate &&
                            !exitResult &&
                            !entryResult && (
                                <div className="waiting-panel">

                                    <div className="camera-icon">
                                        📷
                                    </div>

                                    <strong>
                                        Waiting for vehicle...
                                    </strong>

                                    <p>
                                        Position a vehicle in front
                                        of the camera.
                                    </p>

                                </div>
                            )}


                        {false && detectedPlate && (
                            <div className="detected-panel">

                                <div className="detected-header">

                                    <div>
                                        <span className="detected-label">
                                            Vehicle Detected
                                        </span>

                                        <h3>
                                            {detectedPlate}
                                        </h3>
                                    </div>

                                    <span className="live-indicator">
                                        ● LIVE
                                    </span>

                                </div>


                                <p className="description">
                                    License plate detected automatically.
                                    Select whether the vehicle is entering
                                    or exiting.
                                </p>


                                <div className="plate-display">

                                    <span className="field-label">
                                        Detected License Plate
                                    </span>

                                    <div className="plate-readonly">
                                        {detectedPlate}
                                    </div>

                                </div>


                                {alreadyParked && (
                                    <div className="error">
                                        Vehicle is already parked in the garage.
                                    </div>
                                )}

                                {detectionSource?.startsWith("exit-") &&
                                    !vehicleAction &&
                                    !exitError && (
                                        <div className="status-message">
                                            Checking vehicle status...
                                        </div>
                                    )}

                                {exitError && (
                                    <div className="error">
                                        {exitError}
                                    </div>
                                )}

                                {!vehicleAction &&
                                    !alreadyParked &&
                                    !exitError &&
                                    !lockActionAlreadyCompleted &&
                                    detectionSource?.startsWith("entry-") && (
                                        <div className="action-selection">

                                            <p className="action-title">
                                                Confirm vehicle entry
                                            </p>

                                            <div className="vehicle-action-buttons">
                                                <button
                                                    className="confirm-button"
                                                    onClick={handleSelectEntry}
                                                    disabled={
                                                        garageFull ||
                                                        entryLoading ||
                                                        exitLoading
                                                    }
                                                >
                                                    {garageFull
                                                        ? "Garage Full"
                                                        : "Entry Vehicle"}
                                                </button>
                                            </div>

                                            {garageFull && (
                                                <p className="description">
                                                    The garage is currently full.
                                                    Entry is unavailable.
                                                </p>
                                            )}

                                        </div>
                                    )}

                                {vehicleAction ===
                                    "entry" && (
                                        <div className="entry-mode">

                                            <h3>
                                                Select Parking Space
                                            </h3>


                                            <p className="description">
                                                A parking space has been
                                                automatically assigned.
                                                Click another available
                                                space if you want to
                                                change it.
                                            </p>


                                            <div className="selected-space-info">

                                                <strong>
                                                    Selected Space:
                                                </strong>

                                                <span>
                                                    {selectedSpace
                                                        ? `Level ${selectedSpace.level} — ${selectedSpace.space}`
                                                        : "No space available"}
                                                </span>

                                            </div>


                                            {entryError && (
                                                <div className="error">
                                                    {entryError}
                                                </div>
                                            )}


                                            <div className="confirmation-buttons">

                                                <button
                                                    className="confirm-button"
                                                    onClick={() => handleConfirmEntry()}
                                                    disabled={
                                                        entryLoading ||
                                                        !selectedSpaceId
                                                    }
                                                >
                                                    {entryLoading
                                                        ? "Processing Entry..."
                                                        : "Confirm Entry"}
                                                </button>


                                                <button
                                                    className="cancel-button"
                                                    onClick={() => {
                                                        setVehicleAction(
                                                            null
                                                        );

                                                        setSelectedSpaceId(
                                                            null
                                                        );

                                                        setEntryError(
                                                            ""
                                                        );
                                                    }}
                                                    disabled={
                                                        entryLoading
                                                    }
                                                >
                                                    Back
                                                </button>

                                            </div>

                                        </div>
                                    )}


                                {vehicleAction ===
                                    "exit" && (
                                        <div className="exit-mode">

                                            <h3>
                                                Exit Vehicle
                                            </h3>


                                            <p className="description">
                                                {exitPaymentRequired
                                                    ? `Select a payment method. Parking is billed at ${formatRupees(exitRatePerMinute ?? 1.67)} per minute.`
                                                    : "Exit is being processed automatically."}
                                            </p>


                                            <div className="exit-plate-confirmation">

                                                <strong>
                                                    Exit plate:
                                                </strong>

                                                <span>
                                                    {detectedPlate}
                                                </span>

                                            </div>


                                            {exitPaymentRequired && (
                                                <>
                                                    <p className="action-title">
                                                        Payment method
                                                    </p>


                                                    <div className="payment-options">

                                                        {showCashPayment && <button
                                                            type="button"
                                                            className={
                                                                `payment-option ${paymentMethod ===
                                                                    "cash"
                                                                    ? "selected"
                                                                    : ""
                                                                }`
                                                            }
                                                            onClick={() => handlePaymentSelection("cash")}
                                                            disabled={
                                                                exitLoading
                                                            }
                                                        >
                                                            <span>Cash</span>
                                                        </button>}


                                                        {showCardPayment && <button
                                                            type="button"
                                                            className={
                                                                `payment-option ${paymentMethod ===
                                                                    "card"
                                                                    ? "selected"
                                                                    : ""
                                                                }`
                                                            }
                                                            onClick={() => handlePaymentSelection("card")}
                                                            disabled={
                                                                exitLoading
                                                            }
                                                        >
                                                            <span>Card</span>
                                                        </button>}

                                                    </div>
                                                </>
                                            )}


                                            {exitError && (
                                                <div className="error">
                                                    {exitError}
                                                </div>
                                            )}

                                            {exitLoading && <p className="description">Processing Exit...</p>}

                                        </div>
                                    )}

                            </div>
                        )}

                    </section>


                </section>

            </main>
        </div>
    );
}

export default GaragePage;
