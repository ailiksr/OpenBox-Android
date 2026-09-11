if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (const r of regs) r.unregister();
  });
}
if ('caches' in window) {
  caches.keys().then(keys => {
    for (const k of keys) caches.delete(k);
  });
}