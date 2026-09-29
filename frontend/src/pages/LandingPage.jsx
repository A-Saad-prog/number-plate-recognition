import { useEffect, useRef, useState } from "react";
import cameraImage from "../assets/landing/parking-camera.png";
import "../styles/LandingPage.css";

function LandingPage() {
    const [dark, setDark] = useState(false);
    const [visible, setVisible] = useState({});
    const [counts, setCounts] = useState({});
    const revealRefs = useRef([]);

    useEffect(() => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    setVisible((current) => ({ ...current, [entry.target.dataset.reveal]: true }));
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12, rootMargin: "0px 0px -50px 0px" });
        revealRefs.current.forEach((element) => element && observer.observe(element));
        return () => observer.disconnect();
    }, []);

    const animateCount = (key, target) => {
        const started = performance.now();
        const step = (now) => {
            const progress = Math.min((now - started) / 950, 1);
            const eased = 1 - ((1 - progress) ** 3);
            setCounts((current) => ({ ...current, [key]: Math.round(target * eased) }));
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };

    useEffect(() => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const { countKey, countTarget } = entry.target.dataset;
                    animateCount(countKey, Number(countTarget));
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.7 });
        document.querySelectorAll(".parkingos-landing [data-count-target]").forEach((element) => observer.observe(element));
        return () => observer.disconnect();
    }, []);

    const addReveal = (element) => {
        if (element && !revealRefs.current.includes(element)) revealRefs.current.push(element);
    };
    const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

    return (
        <div className={`parkingos-landing${dark ? " is-dark" : ""}`}>
            <div className="landing-shell">
                <header className="landing-header">
                    <div className="landing-logo">PARKING<span>OS</span></div>
                    <div className="landing-top-actions">
                        <div className="landing-theme-switch-wrap">
                            <button className="landing-theme-switch" type="button" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={dark} title={dark ? "Light mode" : "Dark mode"} onClick={() => setDark((current) => !current)}>
                                <span className="landing-theme-switch-track"><span className="landing-theme-icon landing-theme-icon-sun" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.6" /><path d="M12 2v2.2M12 19.8V22M4.93 4.93l1.56 1.56M17.51 17.51l1.56 1.56M2 12h2.2M19.8 12H22M4.93 19.07l1.56-1.56M17.51 6.49l1.56-1.56" /></svg></span><span className="landing-theme-switch-knob" /><span className="landing-theme-icon landing-theme-icon-moon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20.4 15.3A8.7 8.7 0 0 1 8.7 3.6 8.8 8.8 0 1 0 20.4 15.3Z" /></svg></span></span>
                            </button>
                        </div>
                    </div>
                </header>

                <main>
                    <section className="landing-hero">
                        <div>
                            <div className="landing-eyebrow">Smart Parking Intelligence</div>
                            <h1>Every plate.<br /><span className="landing-accent">Every space.</span><br />In sync.</h1>
                            <p>PARKINGOS recognizes arriving and exiting vehicles, assigns available spaces, manages sessions and keeps the whole garage visible from one operating system.</p>
                            <div className="landing-hero-actions"><button className="landing-primary" onClick={() => scrollTo("landing-system")}>Explore the system <span className="landing-arrow">→</span></button><button className="landing-secondary" onClick={() => scrollTo("landing-features")}>See how it works</button></div>
                        </div>
                        <div className="landing-vision-card">
                            <div className="landing-camera-head"><span>ENTRY CAMERA / 01</span><span className="landing-live"><i />VISION ACTIVE</span></div>
                            <div className="landing-camera-view"><img src={cameraImage} alt="KMB-728 plate detected in parking garage" /></div>
                            <div className="landing-camera-foot"><span>AUTO ASSIGN / ON</span><span>SPACE / L1-01</span></div>
                        </div>
                    </section>

                    <section className="landing-metrics">
                        {["cameras across entry + exit", "levels supported", "parking spaces per tenant", "connected operating view"].map((label, index) => <div className="landing-metric" key={label}><strong data-count-key={`metric-${index}`} data-count-target={index === 0 ? 4 : index === 1 ? 12 : index === 2 ? 1000 : 1}>{counts[`metric-${index}`] ?? 0}</strong><span>{label}</span></div>)}
                        <div className="landing-tech-marquee" aria-hidden="true"><div className="landing-tech-marquee-track"><div className="landing-tech-marquee-group">{["REAL-TIME DETECTION", "SMART SPACE ALLOCATION", "ENTRY / EXIT AUTOMATION", "LIVE PARKING STATUS", "ANPR INTELLIGENCE", "AUTOMATIC SPACE ASSIGNMENT", "CAMERA LANE CONTROL", "PLATE CONFIDENCE TRACKING", "PARKING FLOW ANALYTICS", "OCCUPANCY AWARENESS", "MULTI-LEVEL GARAGE CONTROL", "CONNECTED OPERATIONS"].map((item) => <span key={item}>{item}</span>)}</div><div className="landing-tech-marquee-group" aria-hidden="true">{["REAL-TIME DETECTION", "SMART SPACE ALLOCATION", "ENTRY / EXIT AUTOMATION", "LIVE PARKING STATUS", "ANPR INTELLIGENCE", "AUTOMATIC SPACE ASSIGNMENT", "CAMERA LANE CONTROL", "PLATE CONFIDENCE TRACKING", "PARKING FLOW ANALYTICS", "OCCUPANCY AWARENESS", "MULTI-LEVEL GARAGE CONTROL", "CONNECTED OPERATIONS"].map((item) => <span key={`copy-${item}`}>{item}</span>)}</div></div></div>
                    </section>

                    <section id="landing-features" className={`landing-section landing-reveal ${visible.features ? "visible" : ""}`} data-reveal="features" ref={addReveal}><div className="landing-section-title"><div><div className="landing-eyebrow">Built for the full journey</div><h2>From camera<br />to checkout.</h2></div><p>A single flow connects plate recognition, parking allocation, session tracking, whitelist logic, billing and administration without forcing the operator to jump between tools.</p></div><div className="landing-feature-grid">{[["01 / VISION", "Plate recognition", "Entry and exit cameras detect registration plates and hand verified readings into the parking workflow."], ["02 / PARKING", "Automatic allocation", "Available spaces are surfaced immediately so vehicles can be assigned quickly while operators keep manual control."], ["03 / ADMIN", "Operational control", "Manage whitelists, garage configuration, lane cameras and the rules that keep the system running."]].map(([tag, title, copy]) => <article className="landing-feature" key={tag}><b>{tag}</b><h3>{title}</h3><p>{copy}</p></article>)}</div></section>

                    <section id="landing-system" className={`landing-section landing-flow landing-reveal ${visible.flow ? "visible" : ""}`} data-reveal="flow" ref={addReveal}><div className="landing-eyebrow">One continuous workflow</div><div className="landing-flow-grid">{[["01", "Vehicle arrives", "The entry camera captures a clean frame as the vehicle approaches the lane."], ["02", "Plate is read", "Vision processing detects and recognizes the registration number."], ["03", "Space is assigned", "The garage selects the first available slot and starts the parking session."], ["04", "Exit is settled", "The vehicle is matched, payment is completed and the space becomes available again."]].map(([number, title, copy]) => <div className="landing-step" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></div>)}</div></section>

                    <section className={`landing-cta landing-reveal ${visible.cta ? "visible" : ""}`} data-reveal="cta" ref={addReveal}><div className="landing-eyebrow">Smarter parking starts at the gate</div><h2>Turn every arrival into a <span className="landing-accent">clean data point.</span></h2></section>
                </main>

                <footer className={`landing-footer landing-reveal ${visible.footer ? "visible" : ""}`} data-reveal="footer" ref={addReveal}><div className="landing-footer-top"><div><div className="landing-logo">PARKING<span>OS</span></div><p className="landing-footer-copy">A number-plate recognition and parking management system designed to make garage operations faster, clearer and more automatic.</p></div><div className="landing-footer-col"><h4>Company</h4><button>About us</button><button>Contact us</button><button onClick={() => scrollTo("landing-system")}>Our system</button></div><div className="landing-footer-col"><h4>Legal</h4><button>Terms &amp; conditions</button><button>Privacy</button><button>Usage policy</button></div><div className="landing-footer-col"><h4>Social</h4><div className="landing-socials"><button>IG</button><button>IN</button><button>X</button><button>GH</button></div></div></div><div className="landing-footer-bottom"><span>© 2026 PARKINGOS</span><span>NUMBER PLATE RECOGNITION SYSTEM</span></div></footer>
            </div>
        </div>
    );
}

export default LandingPage;
