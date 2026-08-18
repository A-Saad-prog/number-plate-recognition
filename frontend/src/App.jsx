import { useEffect, useRef, useState } from "react";

import {
    getParkingSpaces,
    registerEntry,
    exitUsingPlate,
    detectPlateFromFrame,
} from "./services/api";

import "./App.css";


function App() {
    const [detectedPlate, setDetectedPlate] = useState("");
    const [vehicleAction, setVehicleAction] = useState(null);

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

    const [parkingSpaces, setParkingSpaces] = useState([]);
    const [parkingLoading, setParkingLoading] = useState(false);
    const [parkingError, setParkingError] = useState("");

    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const visionProcessingRef = useRef(false);

    const [cameraError, setCameraError] = useState("");
    const [cameraActive, setCameraActive] = useState(false);


    // ============================================================
// Camera Vision
// ============================================================

async function processCameraFrame() {

    if (
        !videoRef.current ||
        !canvasRef.current ||
        !cameraActive ||
        visionProcessingRef.current
    ) {
        return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (
        video.readyState <
        HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
        return;
    }

    const context =
        canvas.getContext("2d");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
    );

    const image =
        canvas.toDataURL(
            "image/jpeg",
            0.8
        );

    try {

        visionProcessingRef.current = true;

        const result =
            await detectPlateFromFrame(image);

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
                detectedPlateRef.current ||
                plate === lastCompletedPlateRef.current
            ) {
                return;
            }

            if (plate === plateCandidateRef.current) {
                plateCandidateCountRef.current += 1;
            } else {
                plateCandidateRef.current = plate;
                plateCandidateCountRef.current = 1;
            }

            if (plateCandidateCountRef.current >= 3) {
                detectedPlateRef.current = plate;

                plateCandidateRef.current = "";
                plateCandidateCountRef.current = 0;

                setDetectedPlate(plate);
                setVehicleAction(null);
                setSelectedSpaceId(null);

                setEntryError("");
                setExitError("");

                setEntryResult(null);
                setExitResult(null);
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


    async function startCamera() {

    try {

        setCameraError("");

        const stream =
            await navigator.mediaDevices.getUserMedia({
                video: {
                    width: 640,
                    height: 480,
                    facingMode: "environment",
                },
                audio: false,
            });

        if (videoRef.current) {

            videoRef.current.srcObject =
                stream;
        }

        setCameraActive(true);

    } catch (error) {

        console.error(
            "Camera error:",
            error
        );

        setCameraError(
            "Could not access the camera. Please allow camera permission."
        );
    }
}

    
    function formatDateTime(value) {
        if (!value) {
            return "Unknown";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return date.toLocaleString();
    }


    async function loadParkingSpaces() {
        try {
            setParkingLoading(true);
            setParkingError("");

            const result = await getParkingSpaces();

            if (result.success) {
                setParkingSpaces(result.spaces || []);
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

    useEffect(() => {
    if (!cameraActive) {
        return;
    }

    const interval = setInterval(() => {
        processCameraFrame();
    }, 1000);

    return () => {
        clearInterval(interval);
    };
}, [cameraActive]);


    useEffect(() => {
        loadParkingSpaces();

        const interval = setInterval(() => {
            loadParkingSpaces();
        }, 3000);

        return () => {
            clearInterval(interval);
        };
    }, []);


    useEffect(() => {
    startCamera();

    return () => {
        if (videoRef.current?.srcObject) {
            const tracks =
                videoRef.current.srcObject.getTracks();

            tracks.forEach((track) => track.stop());
        }
    };
}, []);

    function handleSelectEntry() {
        setVehicleAction("entry");
        setEntryError("");
        setExitError("");
        setEntryResult(null);
        setExitResult(null);
    }


    function handleSelectExit() {
        setVehicleAction("exit");
        setEntryError("");
        setExitError("");
        setEntryResult(null);
        setExitResult(null);
        setSelectedSpaceId(null);
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
                "Please select an available parking space."
            );
            return;
        }

        setEntryLoading(true);
        setEntryError("");
        setEntryResult(null);

        try {
            const result = await registerEntry(
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

            // Keep this plate blocked until the camera no longer sees it.
            lastCompletedPlateRef.current = detectedPlate;

            setEntryResult(vehicle);


            detectedPlateRef.current = "";
            setDetectedPlate("");
            plateCandidateRef.current = "";
            plateCandidateCountRef.current = 0;
            setVehicleAction(null);
            setSelectedSpaceId(null);

            await loadParkingSpaces();
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
            setEntryLoading(false);
        }
    }


    async function handleConfirmExit() {
        if (!detectedPlate) {
            setExitError(
                "No vehicle license plate has been detected."
            );
            return;
        }

        setExitLoading(true);
        setExitError("");
        setExitResult(null);

        try {
            const result = await exitUsingPlate(
                detectedPlate
            );

            if (!result.success) {
                setExitError(
                    result.error ||
                    "Vehicle exit failed."
                );
                return;
            }

            const vehicle = result.vehicle;

            lastCompletedPlateRef.current = detectedPlate;

            setExitResult(vehicle);

            detectedPlateRef.current = "";
            setDetectedPlate("");
            plateCandidateRef.current = "";
            plateCandidateCountRef.current = 0;
            setVehicleAction(null);
            setSelectedSpaceId(null);

            await loadParkingSpaces();
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
            setExitLoading(false);
        }
    }


    function handleCancelDetection() {
        detectedPlateRef.current = "";
        setDetectedPlate("");
        setVehicleAction(null);
        setSelectedSpaceId(null);
        setEntryError("");
        setExitError("");
        setEntryResult(null);
        setExitResult(null);
    }


    const totalSpaces = parkingSpaces.length;

    const occupiedSpaces = parkingSpaces.filter(
        (space) => space.is_occupied
    ).length;

    const availableSpaces =
        totalSpaces - occupiedSpaces;

    const selectedSpace = parkingSpaces.find(
        (space) => space.id === selectedSpaceId
    );

    const garageFull =
        totalSpaces > 0 &&
        availableSpaces === 0;


    function renderLevel(level) {
        const spaces = parkingSpaces.filter(
            (space) =>
                Number(space.level) ===
                Number(level)
        );

        return (
            <div
                className="parking-level"
                key={level}
            >
                <h3>
                    Level {level}
                </h3>

                <div className="parking-grid">
                    {spaces.map((space) => {
                        const isSelected =
                            selectedSpaceId === space.id;

                        const vehicle = space.is_occupied
                            ? {
                                license_plate: space.license_plate,
                                entry_time: space.entry_time,
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
                                    handleSpaceSelection(space)
                                }
                                disabled={
                                    space.is_occupied ||
                                    entryLoading ||
                                    exitLoading ||
                                    vehicleAction !== "entry"
                                }
                            >
                                <span className="parking-space-number">
                                    {space.space}
                                </span>

                                {space.is_occupied ? (
                                    vehicle ? (
                                        <div className="parking-space-vehicle">
                                            <strong>
                                                {vehicle.license_plate}
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
            </div>
        );
    }


    function renderVehicleInformation() {
        if (exitResult) {
            return (
                <div className="vehicle-info-panel exit-info">
                    <div className="vehicle-info-header">
                        <span>
                            EXIT COMPLETED
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
                            {exitResult.duration_hours}
                            {" "}hour(s)
                        </span>
                    </div>

                    <div className="vehicle-info-row">
                        <strong>
                            Parking Space
                        </strong>

                        <span>
                            Level {exitResult.level}
                            {" — "}
                            {exitResult.space}
                        </span>
                    </div>

                    <div className="vehicle-info-amount">
                        <span>
                            Amount Billed
                        </span>

                        <strong>
                            {exitResult.amount}
                        </strong>
                    </div>
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
                            Level {entryResult.level}
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
                                : vehicleAction === "exit"
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
                    Vehicle information will appear here
                    when a vehicle is detected.
                </p>
            </div>
        );
    }


    return (
        <div className="app">
            <header className="header">
                <div>
                    <h1>
                        Parking Garage
                    </h1>

                    <p>
                        License Plate Parking Management System
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
                                            {occupiedSpaces} of{" "}
                                            {totalSpaces} spaces occupied
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

                            {renderLevel(1)}
                            {renderLevel(2)}
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

                        <div className="camera-preview">

                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                            />

                            <canvas
                                ref={canvasRef}
                                style={{ display: "none" }}
                            />

                        </div>

                        {cameraError && (
                            <div className="error">
                                {cameraError}
                            </div>
                        )}

                        {!detectedPlate && (
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
                                            What would you like to do?
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

                                            <button
                                                className="exit-button"
                                                onClick={handleSelectExit}
                                                disabled={
                                                    entryLoading ||
                                                    exitLoading
                                                }
                                            >
                                                Exit Vehicle
                                            </button>
                                        </div>

                                        {garageFull && (
                                            <p className="description">
                                                The garage is currently
                                                full. Entry is unavailable,
                                                but vehicles can still exit.
                                            </p>
                                        )}
                                    </div>
                                )}


                                {vehicleAction === "entry" && (
                                    <div className="entry-mode">
                                        <h3>
                                            Select Parking Space
                                        </h3>

                                        <p className="description">
                                            Select an available space
                                            for this vehicle.
                                        </p>

                                        <div className="selected-space-info">
                                            <strong>
                                                Selected Space:
                                            </strong>

                                            <span>
                                                {selectedSpace
                                                    ? `Level ${selectedSpace.level} — ${selectedSpace.space}`
                                                    : "None selected"}
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
                                                    setVehicleAction(null);
                                                    setSelectedSpaceId(null);
                                                    setEntryError("");
                                                }}
                                                disabled={entryLoading}
                                            >
                                                Back
                                            </button>
                                        </div>
                                    </div>
                                )}


                                {vehicleAction === "exit" && (
                                    <div className="exit-mode">
                                        <h3>
                                            Exit Vehicle
                                        </h3>

                                        <p className="description">
                                            The detected license plate
                                            will be used to find the
                                            vehicle's active parking
                                            session.
                                        </p>

                                        <div className="exit-plate-confirmation">
                                            <strong>
                                                Exit plate:
                                            </strong>

                                            <span>
                                                {detectedPlate}
                                            </span>
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
                                                disabled={exitLoading}
                                            >
                                                {exitLoading
                                                    ? "Processing Exit..."
                                                    : "Confirm Exit"}
                                            </button>

                                            <button
                                                className="cancel-button"
                                                onClick={() => {
                                                    setVehicleAction(null);
                                                    setExitError("");
                                                }}
                                                disabled={exitLoading}
                                            >
                                                Back
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>


                    <aside className="card vehicle-information-card">
                        <h2>
                            Vehicle Information
                        </h2>

                        <p className="description">
                            Current entry or exit information.
                        </p>

                        {renderVehicleInformation()}
                    </aside>
                </section>
            </main>
        </div>
    );
}


export default App;