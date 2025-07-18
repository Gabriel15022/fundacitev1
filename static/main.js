document.addEventListener('DOMContentLoaded', () => {
    const contentArea = document.getElementById('content-area');
    const contentTitle = document.getElementById('content-title');
    const viewTasksBtn = document.getElementById('view-tasks-btn');
    const createTaskBtn = document.getElementById('create-task-btn');
    const exportSelectedBtn = document.getElementById('export-selected-btn');
    const exportAllBtn = document.getElementById('export-all-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const welcomeMessageElement = document.getElementById('welcome-message');
    
    // NUEVOS BOTONES DE EXPORTACIÓN POR ESTADO
    const exportCompletedBtn = document.getElementById('export-completed-btn');
    const exportPendingAttendedBtn = document.getElementById('export-pending-attended-btn');
    
    // Nuevo elemento para las notificaciones en página
    const notificationArea = document.createElement('div');
    notificationArea.id = 'notification-area';
    notificationArea.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #4CAF50; /* Verde */
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        z-index: 1000;
        display: none; /* Oculto por defecto */
        opacity: 0;
        transition: opacity 0.5s ease-in-out;
    `;
    document.body.appendChild(notificationArea);


    let allTasks = []; // Variable global para almacenar todas las tareas
    let currentUserDepartment = ''; // Almacena el departamento del usuario logueado
    let currentUsername = ''; // Almacena el nombre de usuario logueado
    let initialLoad = true; // Para evitar notificación en la carga inicial

    // Departamentos del documento para el formulario
    const DEPARTAMENTOS = ['DTISC', 'DIAC', 'DGA', 'ECHALBA', 'PRE', 'DIE', 'DCCIP'];

    // Función para mostrar una notificación temporal
    const showNotification = (message) => {
        notificationArea.textContent = message;
        notificationArea.style.display = 'block';
        notificationArea.style.opacity = '1';
        setTimeout(() => {
            notificationArea.style.opacity = '0';
            setTimeout(() => {
                notificationArea.style.display = 'none';
            }, 500); // Espera a que la transición termine antes de ocultar
        }, 3000); // Muestra la notificación por 3 segundos
    };

    // Función para obtener y mostrar la información del usuario actual
    const fetchAndDisplayCurrentUser = async () => {
        try {
            const response = await fetch('/api/current_user');
            if (response.ok) {
                const data = await response.json();
                currentUserDepartment = data.departamento;
                currentUsername = data.username;
                if (welcomeMessageElement) {
                    welcomeMessageElement.textContent = `Bienvenido, ${currentUserDepartment}`;
                }
                // Una vez que el usuario está cargado, podemos cargar las tareas
                renderTaskList(); // <--- Llamada inicial para cargar el dashboard
                startTaskPolling(); // Inicia el chequeo periódico
            } else {
                // Si no hay sesión activa, redirigir al login
                window.location.href = '/login';
            }
        } catch (error) {
            console.error('Error al obtener la información del usuario actual:', error);
            window.location.href = '/login'; // En caso de error, redirigir al login
        }
    };

    // Llama a esta función al cargar la página para establecer el usuario
    fetchAndDisplayCurrentUser();


    const renderTaskList = async () => {
        // Asegurarse de que el título sea correcto
        contentTitle.textContent = 'Listado de Tareas';

        // Siempre renderizar la estructura básica de la tabla si aún no está presente
        // o si el contentArea no contiene ya una tabla, para asegurar que siempre se muestre.
        let tbody = document.getElementById('task-list-body');
        if (!tbody || contentArea.innerHTML.indexOf('<table') === -1) {
            contentArea.innerHTML = `
                <div class="card">
                    <div class="search-container">
                        <input type="text" id="search-bar" placeholder="Buscar por ID, Cédula, Nombre o Descripción...">
                    </div>
                    <div class="table-responsive">
                        <table>
                            <thead>
                                <tr>
                                    <th></th>
                                    <th>ID</th>
                                    <th>Descripción</th>
                                    <th>Estado</th>
                                    <th>Cédula</th>
                                    <th>Nombre</th>
                                    <th>Tipo</th>
                                    <th>Dpto. Emisor</th>
                                    <th>Dpto. Destino</th>
                                    <th>Fecha y Hora</th>
                                    <th>Quien Atendió</th>
                                    <th>Resolución</th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody id="task-list-body">
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            // Re-obtener el tbody y la barra de búsqueda después de renderizar el HTML
            tbody = document.getElementById('task-list-body');
            const searchBar = document.getElementById('search-bar');

            // Añadir event listener para la barra de búsqueda (solo una vez por renderizado de la estructura)
            if (searchBar) {
                searchBar.addEventListener('input', (e) => {
                    const searchTerm = e.target.value.toLowerCase();
                    const filteredTasks = allTasks.filter(task =>
                        task.id.toString().includes(searchTerm) ||
                        task.cedula.toLowerCase().includes(searchTerm) ||
                        task.nombre.toLowerCase().includes(searchTerm) ||
                        task.descripcion.toLowerCase().includes(searchTerm)
                    );
                    renderFilteredTasks(filteredTasks);
                });
            }
        }
        
        try {
            const response = await fetch('/api/solicitudes');
            if (!response.ok) {
                // Si hay un error, mostraremos el mensaje de error dentro de la tarjeta de la tabla
                // sin eliminar la estructura si ya existe.
                if (tbody) { // Solo si el tbody ya se pudo crear
                    tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: red; padding: 20px;">
                                            Error al cargar los datos. Por favor, verifica la conexión con el servidor o intenta nuevamente más tarde.
                                       </td></tr>`;
                }
                throw new Error('Error al obtener los datos del servidor.'); // Continuar lanzando el error para el catch
            }
            const fetchedTasks = await response.json();

            // Detectar si hay nuevas tareas o si la lista ha cambiado (más robusto que solo el conteo)
            const currentTaskIds = new Set(allTasks.map(task => task.id));
            const fetchedTaskIds = new Set(fetchedTasks.map(task => task.id));

            let newTasksFound = false;
            if (fetchedTasks.length !== allTasks.length) {
                newTasksFound = true;
            } else {
                // Check if any ID is missing or new (e.g. if a task was deleted)
                for (const id of fetchedTaskIds) {
                    if (!currentTaskIds.has(id)) {
                        newTasksFound = true;
                        break;
                    }
                }
                if (!newTasksFound) {
                    for (const id of currentTaskIds) {
                        if (!fetchedTaskIds.has(id)) {
                            newTasksFound = true;
                            break;
                        }
                    }
                }
            }


            if (newTasksFound && !initialLoad) { // Evitar notificación en la carga inicial
                showNotification('¡Lista de tareas actualizada!'); // Mensaje más general
            }
            initialLoad = false; // Ya no es la carga inicial

            allTasks = fetchedTasks; // Actualizar la variable global con las tareas más recientes
            
            // Siempre renderizar las tareas en el tbody
            renderFilteredTasks(allTasks);

        } catch (error) {
            console.error('Error al cargar las tareas:', error);
            // El mensaje de error ya se manejó arriba en el tbody, pero aquí para logs o futuras notificaciones
        }
    };

    const renderFilteredTasks = (tasksToRender) => {
        const tbody = document.getElementById('task-list-body');
        if (!tbody) return; // Asegúrate de que el tbody exista antes de intentar llenarlo

        let rowsHtml = '';
        
        if (tasksToRender.length === 0) {
            rowsHtml = `<tr><td colspan="13" style="text-align: center; padding: 20px;">No hay tareas.</td></tr>`;
        } else {
            tasksToRender.forEach(task => {
                const formattedDate = new Date(task.fecha_creacion).toLocaleString();
                
                let actionButtons = '';
                // Mostrar botones de Modificar/Eliminar solo si el usuario es el emisor o receptor
                if (currentUserDepartment === task.dependencia || currentUserDepartment === task.departamento_destino) {
                    // Escapar comillas simples para los parámetros de la función
                    const escapedDesc = task.descripcion ? task.descripcion.replace(/'/g, "\\'") : '';
                    const escapedQuienAtendio = task.quien_atendio ? task.quien_atendio.replace(/'/g, "\\'") : '';
                    const escapedQueHizo = task.que_hizo ? task.que_hizo.replace(/'/g, "\\'") : '';

                    actionButtons = `
                        <button class="btn btn-primary btn-sm" onclick="showModifyForm(${task.id}, '${escapedDesc}', '${task.departamento_destino}', '${task.estado}', '${escapedQuienAtendio}', '${escapedQueHizo}', '${task.dependencia}')">Modificar</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteTask(${task.id})">Eliminar</button>
                    `;
                }
                
                rowsHtml += `
                    <tr data-id="${task.id}">
                        <td><input type="checkbox" class="task-checkbox" value="${task.id}"></td>
                        <td>${task.id}</td>
                        <td>${task.descripcion}</td>
                        <td>${task.estado}</td>
                        <td>${task.cedula}</td>
                        <td>${task.nombre}</td>
                        <td>${task.tipo}</td>
                        <td>${task.dependencia}</td>
                        <td>${task.departamento_destino}</td>
                        <td>${formattedDate}</td>
                        <td>${task.quien_atendio || 'N/A'}</td>
                        <td>${task.que_hizo || 'N/A'}</td>
                        <td>${actionButtons}</td>
                    </tr>
                `;
            });
        }
        
        tbody.innerHTML = rowsHtml;
    };

    // Función genérica para exportar un array de IDs a PDF
    const exportTasksByIds = async (idsToExport, filename) => {
        if (idsToExport.length === 0) {
            alert('No hay registros para exportar.');
            return;
        }

        const payload = {
            ids: idsToExport,
            export_all: false // Siempre false cuando se pasan IDs específicos
        };

        const response = await fetch('/api/export-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename || 'reporte_solicitudes.pdf';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } else {
            const data = await response.json();
            alert('Error al exportar: ' + data.message);
        }
    };

    // Modificación de la función exportTasks existente para reusar exportTasksByIds
    const exportTasks = async (exportAll) => {
        let taskIds = [];
        if (!exportAll) {
            const checkboxes = document.querySelectorAll('.task-checkbox:checked');
            if (checkboxes.length === 0) {
                alert('Selecciona al menos un registro para exportar.');
                return;
            }
            taskIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
            exportTasksByIds(taskIds, 'reporte_seleccionados.pdf');
        } else {
            taskIds = allTasks.map(task => task.id);
            exportTasksByIds(taskIds, 'reporte_todos.pdf');
        }
    };


    const renderCreateTaskForm = () => {
        contentTitle.textContent = 'Crear Tarea';
        const now = new Date();
        const formattedDateTime = now.toLocaleString();
        
        // Filtra los departamentos para que el propio no aparezca como destino
        const departamentosDestinoFiltrados = DEPARTAMENTOS.filter(dep => dep !== currentUserDepartment);

        let htmlContent = `
            <div class="card">
                <form id="create-task-form">
                    <div class="input-group">
                        <label for="fecha_creacion">Fecha y Hora de Registro:</label>
                        <input type="text" id="fecha_creacion" value="${formattedDateTime}" readonly>
                    </div>
                    <div class="input-group">
                        <label for="cedula">Cédula:</label>
                        <input type="text" id="cedula" name="cedula" required>
                    </div>
                    <div class="input-group">
                        <label for="nombre">Nombre:</label>
                        <input type="text" id="nombre" name="nombre" required>
                    </div>
                    <div class="input-group">
                        <label for="dependencia">Departamento Emisor:</label>
                        <select id="dependencia" name="dependencia" required disabled>
                            <option value="">Seleccione...</option>
                            ${DEPARTAMENTOS.map(dep => `<option value="${dep}" ${dep === currentUserDepartment ? 'selected' : ''}>${dep}</option>`).join('')}
                        </select>
                    </div>
                    <div class="input-group">
                        <label for="tipo">Tipo:</label>
                        <select id="tipo" name="tipo" required>
                            <option value="">Seleccione...</option>
                            <option value="Print">Print</option>
                            <option value="PC">PC</option>
                            <option value="Red">Red</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label for="descripcion">Descripción de la solicitud:</label>
                        <textarea id="descripcion" name="descripcion" required></textarea>
                    </div>
                    <div class="input-group">
                        <label for="departamento_destino">Departamento Destino:</label>
                        <select id="departamento_destino" name="departamento_destino" required>
                            <option value="">Seleccione...</option>
                            ${departamentosDestinoFiltrados.map(dep => `<option value="${dep}">${dep}</option>`).join('')}
                        </select>
                    </div>
                    <button type="submit" class="btn btn-primary">Crear Tarea</button>
                </form>
            </div>
        `;
        contentArea.innerHTML = htmlContent;
        
        document.getElementById('create-task-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const cedula = document.getElementById('cedula').value;
            const nombre = document.getElementById('nombre').value;
            const dependencia = document.getElementById('dependencia').value;
            const tipo = document.getElementById('tipo').value;
            const descripcion = document.getElementById('descripcion').value;
            const departamento_destino = document.getElementById('departamento_destino').value;

            const response = await fetch('/api/solicitudes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cedula, nombre, dependencia, tipo, descripcion, departamento_destino })
            });
            if (response.ok) {
                showNotification('Tarea creada con éxito.'); // Notificación en página
                renderTaskList(); // El emisor también ve su dashboard actualizado inmediatamente
            } else {
                const data = await response.json();
                alert('Error: ' + data.message);
            }
        });
    };

    window.showModifyForm = (id, descripcion, departamento_destino, estado, quien_atendio, que_hizo, dependencia_emisor) => {
        contentTitle.textContent = `Modificar Tarea #${id}`;
        
        // Determinar si el usuario actual es el emisor o el receptor
        const isEmitter = currentUserDepartment === dependencia_emisor;
        const isReceiver = currentUserDepartment === departamento_destino;

        let htmlContent = `
            <div class="card">
                <form id="modify-task-form">
                    <input type="hidden" id="task-id" value="${id}">
                    <div class="input-group">
                        <label for="mod-descripcion">Descripción de la solicitud:</label>
                        <textarea id="mod-descripcion" name="descripcion" required ${isEmitter ? '' : 'disabled'}>${descripcion}</textarea>
                    </div>
                    <div class="input-group">
                        <label for="mod-departamento_destino">Departamento Destino:</label>
                        <select id="mod-departamento_destino" name="departamento_destino" required ${isEmitter ? '' : 'disabled'}>
                            ${DEPARTAMENTOS.map(dep => `<option value="${dep}" ${dep === departamento_destino ? 'selected' : ''}>${dep}</option>`).join('')}
                        </select>
                    </div>
                    <div class="input-group">
                        <label for="mod-estado">Estado de la Tarea:</label>
                        <select id="mod-estado" name="estado" required ${isReceiver ? '' : 'disabled'}>
                            <option value="Recibida" ${estado === 'Recibida' ? 'selected' : ''}>Recibida</option>
                            <option value="Atendida (1era Capa)" ${estado === 'Atendida (1era Capa)' ? 'selected' : ''}>Atendida (1era Capa)</option>
                            <option value="Completada" ${estado === 'Completada' ? 'selected' : ''}>Completada</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label for="mod-quien_atendio">¿Quién atendió? (Tu nombre):</label>
                        <input type="text" id="mod-quien_atendio" name="quien_atendio" value="${quien_atendio || currentUsername || ''}" ${isReceiver ? '' : 'disabled'}>
                    </div>
                    <div class="input-group">
                        <label for="mod-que_hizo">¿Cómo se resolvió? (Descripción de la resolución):</label>
                        <textarea id="mod-que_hizo" name="que_hizo" ${isReceiver ? '' : 'disabled'}>${que_hizo || ''}</textarea>
                    </div>
                    <button type="submit" class="btn btn-primary">Guardar Cambios</button>
                </form>
            </div>
        `;
        contentArea.innerHTML = htmlContent;
        
        document.getElementById('modify-task-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const taskId = id;
            const updateData = {};

            if (isEmitter) {
                updateData.descripcion = document.getElementById('mod-descripcion').value;
                updateData.departamento_destino = document.getElementById('mod-departamento_destino').value;
            } else if (isReceiver) {
                updateData.estado = document.getElementById('mod-estado').value;
                updateData.quien_atendio = document.getElementById('mod-quien_atendio').value;
                updateData.que_hizo = document.getElementById('mod-que_hizo').value;
            } else {
                alert('No tienes permiso para modificar esta tarea.');
                return;
            }
            
            await modifyTask(taskId, updateData);
        });
    };

    window.deleteTask = async (id) => {
        if (confirm('¿Está seguro de que desea eliminar esta tarea?')) {
            const response = await fetch(`/api/solicitudes/${id}`, { method: 'DELETE' });
            if (response.ok) {
                showNotification('Tarea eliminada con éxito.');
                renderTaskList();
            } else {
                const data = await response.json();
                alert('Error: ' + data.message);
            }
        }
    };

    const modifyTask = async (id, updateData) => {
        const response = await fetch(`/api/solicitudes/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });
        if (response.ok) {
                showNotification('Tarea actualizada con éxito.'); // Notificación en página
                renderTaskList();
        } else {
            const data = await response.json();
            alert('Error: ' + data.message);
        }
    };
    
    // Asignar eventos a los botones de la barra lateral
    viewTasksBtn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        viewTasksBtn.classList.add('active');
        renderTaskList();
    });
    
    createTaskBtn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        createTaskBtn.classList.add('active');
        renderCreateTaskForm();
    });

    exportSelectedBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.task-checkbox:checked');
        if (checkboxes.length > 0) {
            exportTasks(false);
        } else {
            alert('Selecciona al menos un registro para exportar.');
        }
    });

    exportAllBtn.addEventListener('click', () => {
        exportTasks(true);
    });
    
    // NUEVOS LISTENERS PARA LOS BOTONES DE EXPORTACIÓN POR ESTADO
    if (exportCompletedBtn) { // Asegúrate de que el botón existe antes de añadir el listener
        exportCompletedBtn.addEventListener('click', () => {
            const completedTasks = allTasks.filter(task => task.estado === 'Completada');
            const idsToExport = completedTasks.map(task => task.id);
            exportTasksByIds(idsToExport, 'reporte_tareas_completadas.pdf');
        });
    }

    if (exportPendingAttendedBtn) { // Asegúrate de que el botón existe antes de añadir el listener
        exportPendingAttendedBtn.addEventListener('click', () => {
            const pendingAttendedTasks = allTasks.filter(task => 
                task.estado === 'Recibida' || task.estado === 'Atendida (1era Capa)'
            );
            const idsToExport = pendingAttendedTasks.map(task => task.id);
            exportTasksByIds(idsToExport, 'reporte_tareas_pendientes_atendidas.pdf');
        });
    }

    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
    });

    // Iniciar el polling de tareas cuando el usuario esté autenticado
    let taskPollingInterval;
    const startTaskPolling = () => {
        // Limpiar cualquier intervalo anterior para evitar duplicados
        if (taskPollingInterval) {
            clearInterval(taskPollingInterval);
        }
        // Polling cada 10 segundos (10000 ms) para una detección más rápida
        taskPollingInterval = setInterval(() => {
            // Solo cargar tareas si la vista actual es el listado de tareas
            if (contentTitle.textContent === 'Listado de Tareas') {
                renderTaskList();
            }
        }, 10000); 
    };
});