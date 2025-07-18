document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const messageArea = document.getElementById('login-message');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();

            if (response.ok) {
                window.location.href = '/';
            } else {
                messageArea.textContent = data.message;
                messageArea.classList.remove('success-message');
                messageArea.classList.add('error-message');
            }
        } catch (error) {
            messageArea.textContent = 'Error al conectar con el servidor.';
            messageArea.classList.remove('success-message');
            messageArea.classList.add('error-message');
        }
    });
});