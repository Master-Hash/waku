'use client';

import { useEffect } from 'react';
import { useRouter } from 'waku';

export const MyButton = () => {
  const router = useRouter();
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
  return (
    <button onClick={() => router.push(`/static`)}>
      Static router.push button
    </button>
  );
};
