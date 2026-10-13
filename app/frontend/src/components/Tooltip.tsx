import {useEffect, useState} from "react";

interface Tip {
    text: string;
    x: number;
    y: number;
    above: boolean;
}

const DELAY = 450;

/**
 * App-wide tooltip for any element with `data-tip`. Native `title` tooltips are
 * mispositioned by WKWebView under the hidden-inset title bar (they land on the
 * traffic lights), so we render our own, anchored to the hovered element.
 */
export function Tooltip() {
    const [tip, setTip] = useState<Tip | null>(null);

    useEffect(() => {
        let timer = 0;
        let current: HTMLElement | null = null;
        const hide = () => {
            clearTimeout(timer);
            current = null;
            setTip(null);
        };
        const onOver = (e: MouseEvent) => {
            const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
            if (el === current) return;
            hide();
            if (!el || !el.dataset.tip) return;
            current = el;
            timer = window.setTimeout(() => {
                const r = el.getBoundingClientRect();
                const above = r.bottom + 40 > window.innerHeight;
                setTip({text: el.dataset.tip!, x: r.left + r.width / 2, y: above ? r.top - 6 : r.bottom + 6, above});
            }, DELAY);
        };
        document.addEventListener("mouseover", onOver);
        document.addEventListener("mousedown", hide, true);
        document.addEventListener("keydown", hide, true);
        window.addEventListener("blur", hide);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("mouseover", onOver);
            document.removeEventListener("mousedown", hide, true);
            document.removeEventListener("keydown", hide, true);
            window.removeEventListener("blur", hide);
        };
    }, []);

    if (!tip) return null;
    return (
        <div className={"tooltip" + (tip.above ? " above" : "")}
             ref={el => {
                 // Clamp horizontally so tips on edge buttons stay inside the window.
                 if (!el) return;
                 const w = el.offsetWidth;
                 const left = Math.max(8, Math.min(window.innerWidth - w - 8, tip.x - w / 2));
                 el.style.left = left + "px";
             }}
             style={{top: tip.y}}>
            {tip.text}
        </div>
    );
}
