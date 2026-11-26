"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./lomi-home.module.css";

export function LomiHome() {
  const [poked, setPoked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function poke() {
    clearTimeout(timer.current);
    setPoked(true);
    timer.current = setTimeout(() => setPoked(false), 1100);
  }

  return (
    <Link href="/" aria-label="Home" onClick={poke} className={`mb-4 flex size-9 items-center justify-center ${styles.home}`} data-poked={poked || undefined}>
      <svg aria-hidden="true" width="28" height="18" viewBox="0 0 14 9" shapeRendering="crispEdges">
        <g className={styles.left}><use href="/icon.svg#claw" y="1" /></g>
        <g className={styles.right}><use href="/icon.svg#claw" x="11" y="1" /></g>
        <use href="/icon.svg#body" />
        <use href="/icon.svg#eyes" className={styles.eyes} />
        <use href="/icon.svg#happy" className={styles.happy} />
        <use href="/icon.svg#brows" className={styles.angry} />
        <use href="/icon.svg#anger" x="7.6" y="-.14" width="4.2" height="4.2" className={styles.angry} />
      </svg>
    </Link>
  );
}
