import { useEffect, useRef, useState } from "react";

import {
    getParkingSpaces,
    registerEntry,
    exitUsingPlate,
    getExitPaymentRequired,
    detectPlateFromFrame,
    getGarageSettings,
} from "../services/api";

import VehicleInformation from "../components/VehicleInformation";

import "../styles/App.css";

const MAX_INFERENCE_FRAME_WIDTH = 960;
const VISION_REQUEST_INTERVAL_MS = 333;
const VISION_DEBUG = import.meta.env.DEV && import.meta.env.VITE_VISION_DEBUG === "true";
const GARAGE_SETTINGS_UPDATED_KEY = "parking_garage_settings_updated";

function boxesEqual(first, second) {
    if (first === second) return true;
    if (!first || !second) return false;
    return first.x1 === second.x1 && first.y1 === second.y1 && first.x2 === second.x2 && first.y2 === second.y2;
}

function GaragePage() {
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

    const detectedPlateRef = useRef({});
    const lastCompletedPlateRef = useRef({});
    const plateCandidateRef = useRef("");
    const plateCandidateCountRef = useRef(0);
    const activeDetectionSourceRef = useRef("entry-1");
    const entrySubmittingRef = useRef(false);
    const exitSubmittingRef = useRef(false);
    const exitPaymentPrefetchRef = useRef({ plate: "", promise: null, result: null });

    const [selectedSpaceId, setSelectedSpaceId] = useState(null);
    const [entryLoading, setEntryLoading] = useState(false);
    const [entryError, setEntryError] = useState("");
    const [alreadyParked, setAlreadyParked] = useState(false);
    const [entryResult, setEntryResult] = useState(null);

    const [exitLoading, setExitLoading] = useState(false);
    const [exitError, setExitError] = useState("");
    const [exitResult, setExitResult] = useState(null);
    const [paymentMethod, setPaymentMethod] = useState(null);
    const [exitPaymentRequired, setExitPaymentRequired] = useState(false);
    const [exitRatePerMinute, setExitRatePerMinute] = useState(null);

    function prefetchExitPaymentRequired(plate) {
        const cached = exitPaymentPrefetchRef.current;
        if (cached.plate === plate && (cached.promise || cached.result)) {
            return cached.promise || Promise.resolve(cached.result);
        }

        const promise = getExitPaymentRequired(plate)
            .then((result) => {
                if (exitPaymentPrefetchRef.current.plate === plate) {
                    exitPaymentPrefetchRef.current = { plate, promise: null, result };
                }
                return result;
            })
            .catch(() => {
                if (exitPaymentPrefetchRef.current.plate === plate) {
                    exitPaymentPrefetchRef.current = { plate, promise: null, result: null };
                }
                return null;
            });

        exitPaymentPrefetchRef.current = { plate, promise, result: null };
        return promise;
    }

    async function getPrefetchedExitPaymentRequired(plate) {
        const cached = exitPaymentPrefetchRef.current;
        if (cached.plate === plate) {
            if (cached.result) return cached.result;
            if (cached.promise) {
                const result = await cached.promise;
                if (result) return result;
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

                if (
                    plate ===
                    plateCandidateRef.current
                ) {
                    plateCandidateCountRef.current += 1;
                } else {
                    plateCandidateRef.current = plate;
                    plateCandidateCountRef.current = 1;
                }

                // The system should react as quickly as possible.
                // A single confirmed read is enough to keep the UI
                // responsive while still avoiding duplicate repeats.
                if (
                    plateCandidateCountRef.current >= 1
                ) {
                    detectedPlateRef.current[source] = plate;

                    plateCandidateRef.current = "";
                    plateCandidateCountRef.current = 0;

                    if (VISION_DEBUG) {
                        console.debug("[Plate accepted]", { source, plate });
                    }

                    setDetectedPlate(plate);
                    setDetectionSource(source);
                    setVehicleAction(null);
                    if (source.startsWith("entry-")) {
                        setAlreadyParked(false);
                        setEntryError("");
                        setEntryResult(null);
                    } else {
                        setExitError("");
                        setExitResult(null);
                        setPaymentMethod(null);
                        setExitRatePerMinute(null);
                        void prefetchExitPaymentRequired(plate);
                    }

                    // ====================================================
                    // AUTOMATIC ENTRY PARKING SPACE ASSIGNMENT
                    // ====================================================

                    const parkedSpace = source.startsWith("entry-")
                        ? parkingSpacesRef.current.find(
                            (space) => space.is_occupied && space.license_plate === plate
                        )
                        : null;

                    if (parkedSpace) {
                        setAlreadyParked(true);
                        setEntryError("Car is already parked in the garage.");
                    } else if (source.startsWith("entry-")) {
                        const automaticSpace =
                            getAutomaticParkingSpace();

                        if (automaticSpace) {
                            setSelectedSpaceId(
                                automaticSpace.id
                            );
                        } else {
                            setSelectedSpaceId(null);
                        }

                        if (adminSettings?.garage_settings?.automatic_entry && automaticSpace) {
                            setVehicleAction("entry");
                            void handleConfirmEntry(plate, automaticSpace.id, source);
                        }
                    }
                }
            } else {
                lastCompletedPlateRef.current[source] = "";
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
        detectedPlateRef.current = {};
        lastCompletedPlateRef.current = {};
        exitPaymentPrefetchRef.current = { plate: "", promise: null, result: null };
        plateCandidateRef.current = "";
        plateCandidateCountRef.current = 0;

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


    useEffect(() => () => Object.keys(cameraStreamsRef.current).forEach(stopSlotCamera), []);


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


    async function handleSelectExit() {
        setVehicleAction("exit");
        setEntryError("");
        setExitError("");
        setEntryResult(null);
        setExitResult(null);
        setSelectedSpaceId(null);
        setPaymentMethod(null);
        setExitPaymentRequired(false);

        const isDetectedVehicleParked = parkingSpacesRef.current.some(
            (space) => space.is_occupied && space.license_plate === detectedPlate
        );

        if (!isDetectedVehicleParked) {
            setExitError("Vehicle is not currently parked in the garage.");
            return;
        }

        try {
            const result = await getPrefetchedExitPaymentRequired(detectedPlate);
            const paymentRequired = Boolean(result.payment_required);
            setExitRatePerMinute(result.rate_per_minute ?? 1.67);
            setExitPaymentRequired(paymentRequired);
            const allowedMethods = [
                adminSettings?.billing_config?.cash_enabled && "cash",
                adminSettings?.billing_config?.card_enabled && "card",
            ].filter(Boolean);
            if (!paymentRequired) {
                await handleConfirmExit(null, false);
            } else if (allowedMethods.length === 1) {
                setPaymentMethod(allowedMethods[0]);
                await handleConfirmExit(allowedMethods[0], true);
            }
        } catch (error) {
            setExitError(error.message || "Could not check exit payment.");
        }
    }


    function handleSpaceSelection(space) {
        if (
            space.is_occupied ||
            entryLoading ||
            exitLoading ||
            vehicleAction !== "entry"
        ) {
            return;
        }

        setSelectedSpaceId(space.id);
        setEntryError("");
    }


    async function handleConfirmEntry(plateOverride = detectedPlate, spaceOverride = selectedSpaceId, sourceOverride = detectionSource || activeDetectionSourceRef.current) {
        if (entrySubmittingRef.current) return;
        if (!plateOverride) {
            setEntryError(
                "No vehicle license plate has been detected."
            );
            return;
        }

        if (!spaceOverride) {
            setEntryError(
                "No parking space is available for this vehicle."
            );
            return;
        }

        entrySubmittingRef.current = true;
        setEntryLoading(true);
        setEntryError("");
        setEntryResult(null);

        try {
            const result =
                await registerEntry(
                    plateOverride,
                    spaceOverride
                );

            if (!result.success) {
                setEntryError(
                    result.error ||
                    "Vehicle entry failed."
                );
                return;
            }

            const vehicle = result.vehicle;

            // Keep this plate blocked until
            // the camera no longer sees it.
            lastCompletedPlateRef.current[sourceOverride] = plateOverride;

            const nextSpaces =
                parkingSpacesRef.current.map(
                    (space) =>
                        space.id === spaceOverride
                            ? {
                                ...space,
                                is_occupied: true,
                                license_plate:
                                    vehicle.license_plate,
                                entry_time:
                                    vehicle.entry_time,
                            }
                            : space
                );

            parkingSpacesRef.current = nextSpaces;
            setParkingSpaces(nextSpaces);

            setEntryResult(vehicle);

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
            console.error(
                "Vehicle entry error:",
                error
            );

            setEntryError(
                error.message ||
                "Vehicle entry failed."
            );

        } finally {
            entrySubmittingRef.current = false;
            setEntryLoading(false);
        }
    }


    async function handleConfirmExit(selectedPaymentMethod = paymentMethod, paymentRequired = exitPaymentRequired) {
        if (exitSubmittingRef.current) return;
        if (!detectedPlate) {
            setExitError(
                "No vehicle license plate has been detected."
            );
            return;
        }

        const normalizedPaymentMethod =
            selectedPaymentMethod === "cash" || selectedPaymentMethod === "card"
                ? selectedPaymentMethod
                : null;

        if (paymentRequired && !selectedPaymentMethod) {
            setExitError(
                "Please select cash or card payment."
            );
            return;
        }

        exitSubmittingRef.current = true;
        setExitLoading(true);
        setExitError("");

        try {
            const result =
                await exitUsingPlate(
                    detectedPlate,
                    paymentRequired ? normalizedPaymentMethod : null
                );

            if (!result.success) {
                setExitError(
                    result.error ||
                    "Vehicle exit failed."
                );
                return;
            }

            const receipt = result.vehicle;

            lastCompletedPlateRef.current[detectionSource || activeDetectionSourceRef.current] =
                detectedPlate;

            const nextSpaces =
                parkingSpacesRef.current.map((space) => {
                    if (
                        space.is_occupied &&
                        space.license_plate === detectedPlate
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

            parkingSpacesRef.current = nextSpaces;
            setParkingSpaces(nextSpaces);

            setExitResult(receipt);

            detectedPlateRef.current[detectionSource || activeDetectionSourceRef.current] = "";
            setDetectedPlate("");
            setDetectionSource(null);

            plateCandidateRef.current = "";
            plateCandidateCountRef.current = 0;

            setVehicleAction(null);
            setSelectedSpaceId(null);
            setPaymentMethod(null);
            setExitLoading(false);

            // Keep the exit receipt visible immediately and sync the
            // backend state after the user sees the confirmation.
            void loadParkingSpaces();

        } catch (error) {
            console.error(
                "Vehicle exit error:",
                error
            );

            setExitError(
                error.message ||
                "Vehicle exit failed."
            );

        } finally {
            exitSubmittingRef.current = false;
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
                            const isSelected =
                                selectedSpaceId ===
                                space.id;

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
                                        entryLoading ||
                                        exitLoading ||
                                        vehicleAction !==
                                        "entry"
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

    const entryCameraCount = Math.max(
        1,
        Number(adminSettings?.camera_config?.entry_lane_cameras) || 1
    );
    const exitCameraCount = Math.max(
        1,
        Number(adminSettings?.camera_config?.exit_lane_cameras) || 1
    );
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
        if (!cameraId.startsWith(`${activeLaneRef.current}-`)) return;
        const deviceId = cameraAssignments[cameraId];
        const video = cameraNodesRef.current[cameraId];
        if (!deviceId || !video || cameraStreamsRef.current[cameraId] || cameraStartingRefBySlot.current[cameraId]) return;
        cameraStartingRefBySlot.current[cameraId] = true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false });
            if (!cameraId.startsWith(`${activeLaneRef.current}-`)) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
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
        if (!cameraId.startsWith(`${activeLaneRef.current}-`)) return;
        const laneGeneration = cameraLaneGenerationRef.current;
        const video = cameraNodesRef.current[cameraId];
        if (!cameraStreamsRef.current[cameraId] || !video || cameraRequestsRef.current[cameraId]) return;
        cameraRequestsRef.current[cameraId] = true;
        const canvas = cameraCanvasesRef.current[cameraId] || document.createElement("canvas");
        cameraCanvasesRef.current[cameraId] = canvas;
        try {
            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                const scale = Math.min(1, MAX_INFERENCE_FRAME_WIDTH / video.videoWidth);
                canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
                canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
                canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
                const result = await detectPlateFromFrame(canvas.toDataURL("image/jpeg", 0.82), cameraId);
                if (
                    cameraStreamsRef.current[cameraId] &&
                    laneGeneration === cameraLaneGenerationRef.current &&
                    cameraId.startsWith(`${activeLaneRef.current}-`)
                ) {
                    setCameraViews((current) => {
                        const currentView = current[cameraId] || {};
                        if (currentView.active && boxesEqual(currentView.box, result.box)) return current;
                        return { ...current, [cameraId]: { ...currentView, active: true, box: result.box || null } };
                    });
                    const plate = result.license_plate?.trim().toUpperCase();
                    if (plate && plate !== detectedPlateRef.current[cameraId] && plate !== lastCompletedPlateRef.current[cameraId]) {
                        detectedPlateRef.current[cameraId] = plate;
                        setDetectedPlate(plate);
                        setDetectionSource(cameraId);
                        setVehicleAction(null);
                        if (cameraId.startsWith("entry-")) {
                            setAlreadyParked(false);
                            setEntryError("");
                            setEntryResult(null);
                        } else {
                            setExitError("");
                            setExitResult(null);
                            setPaymentMethod(null);
                            setExitRatePerMinute(null);
                            void prefetchExitPaymentRequired(plate);
                        }

                        const parkedSpace = cameraId.startsWith("entry-")
                            ? parkingSpacesRef.current.find(
                                (space) => space.is_occupied && space.license_plate === plate
                            )
                            : null;

                        if (parkedSpace) {
                            setAlreadyParked(true);
                            setEntryError("Car is already parked in the garage.");
                        } else if (cameraId.startsWith("entry-")) {
                            const automaticSpace = getAutomaticParkingSpace();
                            if (automaticSpace) {
                                setSelectedSpaceId(automaticSpace.id);
                                if (adminSettings?.garage_settings?.automatic_entry) {
                                    setVehicleAction("entry");
                                    void handleConfirmEntry(plate, automaticSpace.id, cameraId);
                                }
                            } else {
                                setSelectedSpaceId(null);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            if (VISION_DEBUG) console.debug("Vision processing error:", error);
        } finally {
            cameraRequestsRef.current[cameraId] = false;
            if (
                cameraStreamsRef.current[cameraId] &&
                laneGeneration === cameraLaneGenerationRef.current &&
                cameraId.startsWith(`${activeLaneRef.current}-`)
            ) {
                cameraTimersRef.current[cameraId] = window.setTimeout(
                    () => runSlotDetection(cameraId),
                    VISION_REQUEST_INTERVAL_MS
                );
            }
        }
    }

    function renderSlotCamera(slot) {
        const view = cameraViews[slot.id] || {};
        const assigned = Boolean(cameraAssignments[slot.id]);
        const isActiveLane = slot.lane.toLowerCase() === activeLane;
        return <div className="camera-panel" key={slot.id}>
            <div className="camera-panel-header"><div><span className="camera-kicker">{slot.id}</span><strong>{slot.label}</strong></div></div>
            <div className="camera-preview">
                {assigned && <span className={`camera-feed-status camera-status ${isActiveLane && view.active ? "active" : "standby"}`}>{isActiveLane && view.active ? "Live" : "Standby"}</span>}
                {!assigned ? <div className="camera-standby"><strong>Camera not assigned</strong></div> : !isActiveLane ? <div className="camera-standby"><strong>{slot.lane} cameras are on standby</strong></div> : <><video ref={(node) => { cameraNodesRef.current[slot.id] = node; if (node) void startSlotCamera(slot.id); }} autoPlay playsInline muted />{renderDetectionBox(view.box, { current: cameraNodesRef.current[slot.id] })}</>}
            </div>
            {view.error && <div className="error">{view.error}</div>}
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
    const showCashPayment = isDetectedVehicleParked && exitPaymentRequired && Boolean(billingConfig?.payments_enabled && billingConfig?.cash_enabled);
    const showCardPayment = isDetectedVehicleParked && exitPaymentRequired && Boolean(billingConfig?.payments_enabled && billingConfig?.card_enabled);

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

                    <button type="button" className="garage-admin-link" onClick={() => window.open("/admin", "_blank", "noopener,noreferrer")}>Open Admin</button>

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
                        <button type="button" className="lane-switch-button" onClick={switchActiveLane}>{activeLane === "entry" ? "Open Exit" : "Open Entry"}</button>

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


                        {!detectedPlate &&
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


                        {detectedPlate && (
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
                                        Car is already parked in the garage.
                                    </div>
                                )}

                                {!vehicleAction && !alreadyParked && (
                                    <div className="action-selection">

                                        <p className="action-title">
                                            {detectionSource?.startsWith(
                                                "exit-"
                                            )
                                                ? "Confirm vehicle exit"
                                                : "Confirm vehicle entry"}
                                        </p>


                                        <div className="vehicle-action-buttons">

                                            {detectionSource?.startsWith(
                                                "entry-"
                                            ) && (
                                                    <button
                                                        className="confirm-button"
                                                        onClick={
                                                            handleSelectEntry
                                                        }
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
                                                )}


                                            {detectionSource?.startsWith("exit-") &&
                                                (parkingSpaces.some(
                                                    (space) => space.is_occupied && space.license_plate === detectedPlate
                                                ) ? (
                                                    <button
                                                        className="exit-button"
                                                        onClick={
                                                            handleSelectExit
                                                        }
                                                        disabled={
                                                            entryLoading ||
                                                            exitLoading
                                                        }
                                                    >
                                                        Exit Vehicle
                                                    </button>
                                                ) : (
                                                    <div className="error">
                                                        Car is not parked in the garage.
                                                    </div>
                                                ))}

                                        </div>


                                        {garageFull &&
                                            detectionSource?.startsWith(
                                                "entry-"
                                            ) && (
                                                <p className="description">
                                                    The garage is currently
                                                    full. Entry is unavailable.
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
                                                    ? `Select a payment method, then confirm exit. Parking is billed at ${formatRupees(exitRatePerMinute ?? 1.67)} per minute.`
                                                    : "Confirm exit to complete the parking session."}
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
                                                            onClick={() => {
                                                                setPaymentMethod(
                                                                    "cash"
                                                                );

                                                                setExitError(
                                                                    ""
                                                                );
                                                            }}
                                                            disabled={
                                                                exitLoading
                                                            }
                                                        >
                                                            <span>💵</span><span>Cash</span>
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
                                                            onClick={() => {
                                                                setPaymentMethod(
                                                                    "card"
                                                                );

                                                                setExitError(
                                                                    ""
                                                                );
                                                            }}
                                                            disabled={
                                                                exitLoading
                                                            }
                                                        >
                                                            <span>💳</span><span>Card</span>
                                                        </button>}

                                                    </div>
                                                </>
                                            )}


                                            {exitError && (
                                                <div className="error">
                                                    {exitError}
                                                </div>
                                            )}


                                            <div className="confirmation-buttons">

                                                <button
                                                    className="exit-button"
                                                    onClick={() => handleConfirmExit()}
                                                    disabled={
                                                        exitLoading ||
                                                        (exitPaymentRequired && !paymentMethod)
                                                    }
                                                >
                                                    {exitLoading
                                                        ? "Processing Exit..."
                                                        : "Proceed to Exit"}
                                                </button>


                                                <button
                                                    className="cancel-button"
                                                    onClick={() => {
                                                        setVehicleAction(
                                                            null
                                                        );

                                                        setExitError(
                                                            ""
                                                        );

                                                        setPaymentMethod(
                                                            null
                                                        );
                                                    }}
                                                    disabled={
                                                        exitLoading
                                                    }
                                                >
                                                    Back
                                                </button>

                                            </div>

                                        </div>
                                    )}

                            </div>
                        )}

                    </section>


                    {(exitResult || exitCameraActive && detectionSource?.startsWith("exit-")) && (
                        <section className="card vehicle-information-card">

                            <h2>
                                Receipt
                            </h2>

                            <p className="description">
                                Entry and exit details appear here
                                after a vehicle is processed.
                            </p>

                            <VehicleInformation
                                exitResult={exitResult}
                                entryResult={entryResult}
                                detectedPlate={detectedPlate}
                                vehicleAction={vehicleAction}
                                selectedSpace={selectedSpace}
                                onReceiptDone={() => setExitResult(null)}
                            />

                        </section>
                    )}

                </section>

            </main>
        </div>
    );
}


export default GaragePage;
