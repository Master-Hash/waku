'use client';

import { useEffect } from 'react';
import type { ReactElement } from 'react';

export default function Layout({ children }: { children: ReactElement }) {
  useEffect(() => {
    const onStart = () => {
      console.log('[router event] Route change started');
    };
    const onComplete = () => {
      console.log('[router event] Route change completed');
    };
    window.navigation.addEventListener('navigate', onStart);
    window.navigation.addEventListener('navigatesuccess', onComplete);

    return () => {
      window.navigation.removeEventListener('navigate', onStart);
      window.navigation.removeEventListener('navigatesuccess', onComplete);
    };
  });
  return <>{children}</>;
}
