(() => {
	let theme = 'system';
	try { theme = localStorage.getItem('revento-theme') || 'system'; } catch {}
	const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
	document.documentElement.dataset.theme = dark ? 'dark' : 'light';
	document.querySelector('meta[name="theme-color"]').content = dark ? '#0c0d16' : '#e5e7f0';
})();
