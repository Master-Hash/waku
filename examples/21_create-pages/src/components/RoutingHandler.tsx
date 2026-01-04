'use client';

import { useEffect } from 'react';

export const RoutingHandler = () => {
  useEffect(() => {
    const onStart = () => {
      console.log('Route change started');
    };
    const onComplete = () => {
      console.log('Route change completed');
    };
    window.navigation.addEventListener('navigate', onStart);
    window.navigation.addEventListener('navigatesuccess', onComplete);
    return () => {
      window.navigation.removeEventListener('navigate', onStart);
      window.navigation.removeEventListener('navigatesuccess', onComplete);
    };
  });
  return null;
};
