import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/AdminTour.css";

const CARD_WIDTH = 300;
const CARD_MARGIN = 16;
const SPOTLIGHT_PADDING = 8;
const MAX_POLL_ATTEMPTS = 60;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function computeLayout(rect, placement, cardSize) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const hole = {
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        width: rect.width + SPOTLIGHT_PADDING * 2,
        height: rect.height + SPOTLIGHT_PADDING * 2,
    };

    const space = {
        top: hole.top,
        bottom: viewportHeight - (hole.top + hole.height),
        left: hole.left,
        right: viewportWidth - (hole.left + hole.width),
    };

    const fits = {
        top: space.top >= cardSize.height + CARD_MARGIN,
        bottom: space.bottom >= cardSize.height + CARD_MARGIN,
        left: space.left >= cardSize.width + CARD_MARGIN,
        right: space.right >= cardSize.width + CARD_MARGIN,
    };

    let side = placement;
    if (!fits[side]) {
        side =
            ["bottom", "top", "right", "left"].find((candidate) => fits[candidate]) ||
            Object.keys(space).reduce((best, key) => (space[key] > space[best] ? key : best), "bottom");
    }

    let cardTop;
    let cardLeft;
    if (side === "top" || side === "bottom") {
        cardTop = side === "top" ? hole.top - cardSize.height - CARD_MARGIN : hole.top + hole.height + CARD_MARGIN;
        cardLeft = hole.left + hole.width / 2 - cardSize.width / 2;
    } else {
        cardLeft = side === "left" ? hole.left - cardSize.width - CARD_MARGIN : hole.left + hole.width + CARD_MARGIN;
        cardTop = hole.top + hole.height / 2 - cardSize.height / 2;
    }

    cardLeft = clamp(cardLeft, 8, Math.max(8, viewportWidth - cardSize.width - 8));
    cardTop = clamp(cardTop, 8, Math.max(8, viewportHeight - cardSize.height - 8));

    let arrowOffset;
    if (side === "top" || side === "bottom") {
        const targetCenter = hole.left + hole.width / 2;
        arrowOffset = clamp(targetCenter - cardLeft, 16, Math.max(16, cardSize.width - 16));
    } else {
        const targetCenter = hole.top + hole.height / 2;
        arrowOffset = clamp(targetCenter - cardTop, 16, Math.max(16, cardSize.height - 16));
    }

    return { hole, side, cardTop, cardLeft, arrowOffset };
}

// Small guided product tour for the Admin page. Purely presentational --
// `onNavigate` is responsible for switching AdminPage's activeFeature so a
// step's target (which may live in a dynamic section) mounts before it is
// measured and spotlighted.
export default function AdminTour({ steps, open, onNavigate, onFinish, onSkip }) {
    const [stepIndex, setStepIndex] = useState(0);
    const [layout, setLayout] = useState(null);
    const cardRef = useRef(null);
    const previousFocusRef = useRef(null);

    // Ref-held callbacks so the navigation/measurement effect below doesn't
    // need them in its dependency array -- including them directly would
    // re-run the effect (and re-call onNavigate) on every parent re-render
    // triggered by the very setActiveFeature call it makes.
    const onNavigateRef = useRef(onNavigate);
    const onFinishRef = useRef(onFinish);
    const onSkipRef = useRef(onSkip);
    useEffect(() => {
        onNavigateRef.current = onNavigate;
        onFinishRef.current = onFinish;
        onSkipRef.current = onSkip;
    });

    const step = steps[stepIndex];

    useEffect(() => {
        if (open) setStepIndex(0);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        previousFocusRef.current = document.activeElement;
        return () => {
            previousFocusRef.current?.focus?.();
        };
    }, [open]);

    useEffect(() => {
        if (!open || !step) return;
        let cancelled = false;
        onNavigateRef.current?.(step.feature);

        const measure = () => {
            const el = document.querySelector(step.target);
            if (!el || cancelled) return false;
            const rect = el.getBoundingClientRect();
            const cardSize = { width: CARD_WIDTH, height: cardRef.current?.offsetHeight || 160 };
            setLayout(computeLayout(rect, step.placement || "bottom", cardSize));
            return true;
        };

        let attempts = 0;
        const poll = () => {
            if (cancelled) return;
            const el = document.querySelector(step.target);
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
                window.setTimeout(() => {
                    if (!cancelled) measure();
                }, 220);
                return;
            }
            attempts += 1;
            if (attempts < MAX_POLL_ATTEMPTS) {
                requestAnimationFrame(poll);
            }
        };

        poll();
        return () => {
            cancelled = true;
        };
    }, [open, stepIndex, step]);

    useEffect(() => {
        if (!open || !step) return;
        const recompute = () => {
            const el = document.querySelector(step.target);
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const cardSize = { width: CARD_WIDTH, height: cardRef.current?.offsetHeight || 160 };
            setLayout(computeLayout(rect, step.placement || "bottom", cardSize));
        };
        window.addEventListener("resize", recompute);
        window.addEventListener("scroll", recompute, true);
        return () => {
            window.removeEventListener("resize", recompute);
            window.removeEventListener("scroll", recompute, true);
        };
    }, [open, step]);

    useEffect(() => {
        if (!open) return;
        cardRef.current?.focus?.();
    }, [open, stepIndex]);

    const goNext = useCallback(() => {
        setStepIndex((index) => {
            if (index >= steps.length - 1) {
                onFinishRef.current?.();
                return index;
            }
            return index + 1;
        });
    }, [steps.length]);

    const goPrevious = useCallback(() => {
        setStepIndex((index) => Math.max(0, index - 1));
    }, []);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event) => {
            if (event.key === "ArrowRight") {
                event.preventDefault();
                goNext();
            } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                goPrevious();
            } else if (event.key === "Escape") {
                event.preventDefault();
                onSkipRef.current?.();
            }
        };
        document.addEventListener("keydown", handleKeyDown, true);
        return () => document.removeEventListener("keydown", handleKeyDown, true);
    }, [open, goNext, goPrevious]);

    if (!open || !step || !layout) return null;

    const { hole, side, cardTop, cardLeft, arrowOffset } = layout;
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === steps.length - 1;

    return createPortal(
        <div className="admin-tour-root">
            <div className="admin-tour-mask" style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
            <div className="admin-tour-mask" style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
            <div className="admin-tour-mask" style={{ top: hole.top, height: hole.height, left: 0, width: Math.max(0, hole.left) }} />
            <div className="admin-tour-mask" style={{ top: hole.top, height: hole.height, left: hole.left + hole.width, right: 0 }} />
            <div
                className="admin-tour-spotlight"
                style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                }}
            />
            <div
                ref={cardRef}
                className={`admin-tour-card admin-tour-card-${side}`}
                style={{ top: cardTop, left: cardLeft, width: CARD_WIDTH, "--arrow-offset": `${arrowOffset}px` }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="admin-tour-title"
                aria-describedby="admin-tour-description"
                tabIndex={-1}
            >
                <div className="admin-tour-dots" aria-hidden="true">
                    {steps.map((tourStep, index) => (
                        <span key={tourStep.id} className={`admin-tour-dot ${index === stepIndex ? "active" : ""}`} />
                    ))}
                </div>
                <h3 id="admin-tour-title">{step.title}</h3>
                <p id="admin-tour-description">{step.description}</p>
                <div className="admin-tour-footer">
                    <span className="admin-tour-count">{stepIndex + 1} of {steps.length}</span>
                    <div className="admin-tour-actions">
                        <button type="button" className="admin-tour-skip" onClick={onSkip}>Skip</button>
                        {!isFirst && (
                            <button type="button" className="admin-tour-previous" onClick={goPrevious}>Previous</button>
                        )}
                        <button type="button" className="admin-tour-next" onClick={goNext}>{isLast ? "Finish" : "Next"}</button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
