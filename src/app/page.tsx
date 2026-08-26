'use client';

import React from 'react';
import { NavisoleShell } from '../components/layout/NavisoleShell';

export default function HomePage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-[#08080a]">
      <NavisoleShell userName="Shaya" />
    </main>
  );
}
