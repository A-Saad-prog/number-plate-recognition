import { useEffect, useRef, useState } from "react";

import {
    getParkingSpaces,
    registerEntry,
    exitUsingPlate,
    detectPlateFromFrame,
} from "./services/api";

import "./App.css";
import AdminPage from "./components/AdminPage";


function GaragePage() {
    const [detectedPlate, setDetectedPlate] = useState("");
    const [vehicleAction, setVehicleAction] = useState(null);
    const [detectionSource, setDetectionSource] = useState(null);

    const detectedPlateRef = useRef("");
    const lastCompletedPlateRef = useRef("");
    const plateCandidateRef = useRef("");
    const plateCandidateCountRef = useRef(0);

    const [selectedSpaceId, setSelectedSpaceId] = useState(null);
    const [entryLoading, setEntryLoading] = useState(false);
    const [entryError, setEntryError] = useState("");
    const [entryResult, setEntryResult] = useState(null);

    const [exitLoading, setExitLoading] = useState(false);
    const [exitError, setExitError] = useState("");
    const [exitResult, setExitResult] = useState(null);
    const [paymentMethod, setPaymentMethod] = useState(null);

    const [parkingSpaces, setParkingSpaces] = useState([]);
    const parkingSpacesRef = useRef([]);
    const [parkingLoading, setParkingLoading] = useState(false);
    const [parkingError, setParkingError] = useState("");
    const [openLevel, setOpenLevel] = useState(1);

    const videoRef = useRef(null);
    const exitVideoRef = useRef(null);
    const exitStreamRef = useRef(null);
    const canvasRef = useRef(null);
    const visionProcessingRef = useRef(false);

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
            !videoRefToProcess.current ||
            !canvasRef.current ||
            !cameraIsActive ||
            visionProcessingRef.current
        ) {
            return;
        }

        const video = videoRefToProcess.current;
        const canvas = canvasRef.current;

        if (
            video.readyState <
            HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
            return;
        }

        const context = canvas.getContext("2d");

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        context.drawImage(
            video,
            0,
            0,
            canvas.width,
            canvas.height
        );

        const image = canvas.toDataURL(
            "image/jpeg",
            0.8
        );

        try {
            const captureStart = performance.now();
            visionProcessingRef.current = true;

            const result =
                await detectPlateFromFrame(image);

            const detectionLatencyMs =
                performance.now() - captureStart;

            console.log(
                "[Vision latency]",
                {
                    source,
                    durationMs: detectionLatencyMs,
                    detected: result?.detected,
                    plate: result?.license_plate || null,
                }
            );

            if (source === "entry") {
                setEntryDetectionBox(result.box || null);
            } else {
                setExitDetectionBox(result.box || null);
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
                    plate === detectedPlateRef.current ||
                    plate === lastCompletedPlateRef.current
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
                    detectedPlateRef.current = plate;

                    plateCandidateRef.current = "";
                    plateCandidateCountRef.current = 0;

                    console.log(
                        "[Plate accepted]",
                        {
                            source,
                            plate,
                            detectionSource: source,
                            detectedAt: new Date().toISOString(),
                        }
                    );

                    setDetectedPlate(plate);
                    setDetectionSource(source);
                    setVehicleAction(null);

                    // ====================================================
                    // AUTOMATIC ENTRY PARKING SPACE ASSIGNMENT
                    // ====================================================

                    if (source === "entry") {
                        const automaticSpace =
                            getAutomaticParkingSpace();

                        if (automaticSpace) {
                            setSelectedSpaceId(
                                automaticSpace.id
                            );
                        } else {
                            setSelectedSpaceId(null);
                        }
                    } else {
                        setSelectedSpaceId(null);
                    }

                    setEntryError("");
                    setExitError("");

                    setEntryResult(null);
                    setExitResult(null);
                    setPaymentMethod(null);
                }
            } else {
                lastCompletedPlateRef.current = "";
            }

        } catch (error) {
            console.error(
                "Vision processing error:",
                error
            );
        } finally {
            visionProcessingRef.current = false;
        }
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
        setError
    ) {
        try {
            setError("");

            const stream =
                await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: 640,
                        height: 480,
                        facingMode: "environment",
                    },
                    audio: false,
                });

            if (videoRefToStart.current) {
                videoRefToStart.current.srcObject =
                    stream;

                videoRefToStart.current
                    .play()
                    .catch(() => {});
            } else if (
                videoRefToStart === exitVideoRef
            ) {
                exitStreamRef.current = stream;
            }

            setActive(true);

        } catch (error) {
            console.error(
                "Camera error:",
                error
            );

            setError(
                "Could not access the camera. Please allow camera permission."
            );
        }
    }


    function clearVehicleDetectionState() {
        detectedPlateRef.current = "";
        lastCompletedPlateRef.current = "";
        plateCandidateRef.current = "";
        plateCandidateCountRef.current = 0;

        setDetectedPlate("");
        setDetectionSource(null);
        setVehicleAction(null);
        setEntryError("");
        setExitError("");
        setEntryResult(null);
        setExitResult(null);
        setPaymentMethod(null);
        setSelectedSpaceId(null);
    }


    async function openExitCamera() {
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
            setExitCameraError
        );
    }


    function closeExitCamera() {
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
            setCameraError
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
        if (value === "card") {
            return "Card";
        }

        if (value === "cash") {
            return "Cash";
        }

        return value || "Unknown";
    }


    async function loadParkingSpaces() {
        try {
            setParkingLoading(true);
            setParkingError("");

            const result =
                await getParkingSpaces();

            if (result.success) {
                const spaces = result.spaces || [];

                setParkingSpaces(spaces);
                parkingSpacesRef.current = spaces;
            } else {
                setParkingError(
                    result.error ||
                    "Could not load parking spaces."
                );
            }

        } catch (error) {
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

        const interval = setInterval(() => {
            processCameraFrame(
                videoRef,
                cameraActive,
                "entry"
            );
        }, 200);

        return () => {
            clearInterval(interval);
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
                .catch(() => {});
        }

        const interval = setInterval(() => {
            processCameraFrame(
                exitVideoRef,
                exitCameraActive,
                "exit"
            );
        }, 200);

        return () => {
            clearInterval(interval);
        };
    }, [exitCameraActive]);


    useEffect(() => {
        const initialLoad =
            setTimeout(() => {
                loadParkingSpaces();
            }, 0);

        const interval =
            setInterval(() => {
                loadParkingSpaces();
            }, 3000);

        return () => {
            clearTimeout(initialLoad);
            clearInterval(interval);
        };
    }, []);


    useEffect(() => {
        startCamera(
            videoRef,
            setCameraActive,
            setCameraError
        );

        return () => {
            if (
                videoRef.current?.srcObject
            ) {
                const tracks =
                    videoRef.current.srcObject
                        .getTracks();

                tracks.forEach((track) =>
                    track.stop()
                );
            }

            if (
                exitVideoRef.current?.srcObject
            ) {
                const tracks =
                    exitVideoRef.current.srcObject
                        .getTracks();

                tracks.forEach((track) =>
                    track.stop()
                );
            }
        };
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


    function handleSelectExit() {
        setVehicleAction("exit");
        setEntryError("");
        setExitError("");
        setEntryResult(null);
        setExitResult(null);
        setSelectedSpaceId(null);
        setPaymentMethod(null);
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


    async function handleConfirmEntry() {
        if (!detectedPlate) {
            setEntryError(
                "No vehicle license plate has been detected."
            );
            return;
        }

        if (!selectedSpaceId) {
            setEntryError(
                "No parking space is available for this vehicle."
            );
            return;
        }

        setEntryLoading(true);
        setEntryError("");
        setEntryResult(null);

        try {
            const result =
                await registerEntry(
                    detectedPlate,
                    selectedSpaceId
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
            lastCompletedPlateRef.current =
                detectedPlate;

            const nextSpaces =
                parkingSpacesRef.current.map(
                    (space) =>
                        space.id === selectedSpaceId
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

            detectedPlateRef.current = "";
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
            if (!entryResult) {
                setEntryLoading(false);
            }
        }
    }


    async function handleConfirmExit() {
        if (!detectedPlate) {
            setExitError(
                "No vehicle license plate has been detected."
            );
            return;
        }

        if (!paymentMethod) {
            setExitError(
                "Please select cash or card payment."
            );
            return;
        }

        setExitLoading(true);
        setExitError("");
        setExitResult(null);

        try {
            const result =
                await exitUsingPlate(
                    detectedPlate,
                    paymentMethod
                );

            if (!result.success) {
                setExitError(
                    result.error ||
                    "Vehicle exit failed."
                );
                return;
            }

            const receipt = result.vehicle;

            lastCompletedPlateRef.current =
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

            detectedPlateRef.current = "";
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
            if (!exitResult) {
                setExitLoading(false);
            }
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
                                    `parking-space ${
                                        space.is_occupied
                                            ? "occupied"
                                            : "available"
                                    } ${
                                        isSelected
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


    return (
        <div className="app">
            <header className="header">
                <div>
                    <h1>
                        ParkingOS
                    </h1>

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
                                        `space-status ${
                                            garageFull
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
                                {[1, 2].map((level) => (
                                    <button
                                        key={level}
                                        type="button"
                                        className={`level-toggle ${
                                            openLevel === level
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


                        <div className="camera-grid">

                            <div className="camera-panel">

                                <div className="camera-panel-header">
                                    <div>
                                        <span className="camera-kicker">
                                            Lane 01
                                        </span>

                                        <strong>
                                            Entry camera
                                        </strong>
                                    </div>

                                </div>


                                <div className="camera-preview">
                                    <span
                                        className={`camera-feed-status camera-status ${
                                            exitCameraActive
                                                ? "standby"
                                                : "active"
                                        }`}
                                    >
                                        {exitCameraActive ? (
                                            "Standby"
                                        ) : (
                                            <>
                                                <span className="live-dot">●</span>
                                                {" Live"}
                                            </>
                                        )}
                                    </span>

                                        {renderDetectionBox(
                                            entryDetectionBox,
                                            videoRef
                                        )}

                                    <video
                                        ref={videoRef}
                                        autoPlay
                                        playsInline
                                        muted
                                        onCanPlay={(event) =>
                                            event.currentTarget
                                                .play()
                                                .catch(
                                                    () => {}
                                                )
                                        }
                                    />
                                </div>

                            </div>


                            <div className="camera-panel">

                                <div className="camera-panel-header">
                                    <div>
                                        <span className="camera-kicker">
                                            Lane 02
                                        </span>

                                        <strong>
                                            Exit camera
                                        </strong>
                                    </div>

                                </div>


                                <div className="camera-preview exit-camera-preview">
                                    <span
                                        className={`camera-feed-status camera-status ${
                                            exitCameraActive
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
                                                        () => {}
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


                                {!vehicleAction && (
                                    <div className="action-selection">

                                        <p className="action-title">
                                            {detectionSource ===
                                            "exit"
                                                ? "Confirm vehicle exit"
                                                : "Confirm vehicle entry"}
                                        </p>


                                        <div className="vehicle-action-buttons">

                                            {detectionSource ===
                                                "entry" && (
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


                                            {detectionSource ===
                                                "exit" && (
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
                                            )}

                                        </div>


                                        {garageFull &&
                                            detectionSource ===
                                                "entry" && (
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
                                                onClick={
                                                    handleConfirmEntry
                                                }
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
                                            Select a payment method,
                                            then confirm exit. Parking
                                            is billed at Rs 1.67 per
                                            minute.
                                        </p>


                                        <div className="exit-plate-confirmation">

                                            <strong>
                                                Exit plate:
                                            </strong>

                                            <span>
                                                {detectedPlate}
                                            </span>

                                        </div>


                                        <p className="action-title">
                                            Payment method
                                        </p>


                                        <div className="payment-options">

                                            <button
                                                type="button"
                                                className={
                                                    `payment-option ${
                                                        paymentMethod ===
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
                                                Cash
                                            </button>


                                            <button
                                                type="button"
                                                className={
                                                    `payment-option ${
                                                        paymentMethod ===
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
                                                Card
                                            </button>

                                        </div>


                                        {exitError && (
                                            <div className="error">
                                                {exitError}
                                            </div>
                                        )}


                                        <div className="confirmation-buttons">

                                            <button
                                                className="exit-button"
                                                onClick={
                                                    handleConfirmExit
                                                }
                                                disabled={
                                                    exitLoading ||
                                                    !paymentMethod
                                                }
                                            >
                                                {exitLoading
                                                    ? "Processing Exit..."
                                                    : "Confirm Exit"}
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


                    {exitCameraActive &&
                        (
                            detectionSource ===
                                "exit" ||
                            exitResult
                        ) && (
                            <section className="card vehicle-information-card">

                                <h2>
                                    Receipt
                                </h2>

                                <p className="description">
                                    Entry and exit details appear here
                                    after a vehicle is processed.
                                </p>

                                {renderVehicleInformation()}

                            </section>
                        )}

                </section>

            </main>
        </div>
    );
}


function App() {
    return window.location.pathname === "/admin"
        ? <AdminPage />
        : <GaragePage />;
}


export default App;