const $ = (id) => document.getElementById(id);

$('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('setup-error');
  const password = $('setup-password-input').value;
  error.textContent = '';

  if (password !== $('setup-confirm-input').value) {
    error.textContent = 'Passwords do not match';
    return;
  }
  if (password.length < 8) {
    error.textContent = 'Password must be at least 8 characters';
    return;
  }

  try {
    const res = await fetch('/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('scoreboard_token', data.token);
      location.href = '/control';
    } else if (res.status === 409) {
      location.href = '/control';
    } else {
      error.textContent = (await res.json()).detail || 'Error';
    }
  } catch {
    error.textContent = 'Connection error';
  }
});
