import { useState, useEffect } from 'react';

/**
 * useVisualViewport Hook (Claude-grade iOS keyboard avoidance)
 * Tracks the real visual viewport height to stick the input bar
 * to the virtual keyboard without pushing the header offscreen.
 */
export function useVisualViewport() {
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );
  const [keyboardOffset, setKeyboardOffset] = useState<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const handleResize = () => {
      if (!window.visualViewport) return;
      const currentHeight = window.visualViewport.height;
      const offset = window.innerHeight - currentHeight;
      setViewportHeight(currentHeight);
      setKeyboardOffset(offset > 50 ? offset : 0);
    };

    window.visualViewport.addEventListener('resize', handleResize);
    window.visualViewport.addEventListener('scroll', handleResize);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('scroll', handleResize);
    };
  }, []);

  return { viewportHeight, keyboardOffset, isKeyboardOpen: keyboardOffset > 50 };
}
