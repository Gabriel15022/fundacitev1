import os
import secrets
from flask import Flask, request, jsonify, session, render_template, send_file
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from werkzeug.security import generate_password_hash, check_password_hash
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.units import inch
from io import BytesIO # Importar BytesIO para manejar el PDF en memoria
from datetime import datetime

basedir = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)
CORS(app)

# Configuración de la sesión para que funcione con Flask
app.config['SECRET_KEY'] = secrets.token_hex(16)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'database.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
migrate = Migrate(app, db)

# Departamentos del documento para el formulario y la creación de usuarios
DEPARTAMENTOS = ['DTISC', 'DIAC', 'DGA', 'ECHALBA', 'PRE', 'DIE', 'DCCIP']

# Modelo de la base de datos de Solicitudes (Añadimos los nuevos campos)
class Solicitud(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    cedula = db.Column(db.String(20), nullable=False)
    nombre = db.Column(db.String(100), nullable=False)
    dependencia = db.Column(db.String(50), nullable=False)  # Departamento emisor
    tipo = db.Column(db.String(50), nullable=False)
    descripcion = db.Column(db.Text, nullable=False)
    departamento_destino = db.Column(db.String(50), nullable=False)
    fecha_creacion = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(50), default='Recibida') # Nuevo campo de estado
    quien_atendio = db.Column(db.String(100), nullable=True) # Nuevo campo de quien atendio
    que_hizo = db.Column(db.Text, nullable=True) # Nuevo campo de que hizo

    def to_dict(self):
        return {
            'id': self.id,
            'cedula': self.cedula,
            'nombre': self.nombre,
            'dependencia': self.dependencia,
            'tipo': self.tipo,
            'descripcion': self.descripcion,
            'departamento_destino': self.departamento_destino,
            'fecha_creacion': self.fecha_creacion,
            'estado': self.status,
            'quien_atendio': self.quien_atendio,
            'que_hizo': self.que_hizo
        }

# Modelo de la base de datos de Usuarios
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    departamento = db.Column(db.String(50), nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

# Rutas
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    user = User.query.filter_by(username=username).first()
    
    if user and user.check_password(password):
        session['user_id'] = user.id
        session['departamento'] = user.departamento
        session['username'] = user.username # Guardar el username en la sesión
        return jsonify({"message": "Login exitoso", "departamento": user.departamento, "username": user.username}), 200
    else:
        return jsonify({"message": "Usuario o contraseña inválidos"}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"message": "Sesión cerrada"}), 200

# Nuevo endpoint para obtener la información del usuario actual (para el frontend)
@app.route('/api/current_user', methods=['GET'])
def get_current_user():
    departamento_del_usuario = session.get('departamento')
    username = session.get('username')
    if not departamento_del_usuario:
        return jsonify({"message": "No autorizado"}), 401
    return jsonify({"departamento": departamento_del_usuario, "username": username}), 200


@app.route('/api/solicitudes', methods=['GET'])
def get_solicitudes():
    departamento_del_usuario = session.get('departamento')
    if not departamento_del_usuario:
        return jsonify({"message": "No autorizado"}), 401
    
    solicitudes = Solicitud.query.filter(
        (Solicitud.departamento_destino == departamento_del_usuario) |
        (Solicitud.dependencia == departamento_del_usuario)
    ).order_by(Solicitud.fecha_creacion.desc()).all() # <-- CAMBIO AQUÍ: Ordenar por fecha_creacion descendente
    
    return jsonify([solicitud.to_dict() for solicitud in solicitudes]), 200

@app.route('/api/solicitudes', methods=['POST'])
def create_solicitud():
    data = request.get_json()
    departamento_del_usuario = session.get('departamento')
    if not departamento_del_usuario:
        return jsonify({"message": "No autorizado"}), 401
    
    try:
        new_solicitud = Solicitud(
            cedula=data['cedula'],
            nombre=data['nombre'],
            dependencia=departamento_del_usuario, # Se toma del usuario logueado
            tipo=data['tipo'],
            descripcion=data['descripcion'],
            departamento_destino=data['departamento_destino'],
            status='Recibida'
        )
        db.session.add(new_solicitud)
        db.session.commit()
        return jsonify({"message": "Tarea creada con éxito"}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": "Error al crear la tarea", "error": str(e)}), 400

# Endpoint para modificar la tarea (ahora con los nuevos campos de respuesta y control de roles)
@app.route('/api/solicitudes/<int:id>', methods=['PUT'])
def update_solicitud(id):
    data = request.get_json()
    solicitud = Solicitud.query.get_or_404(id)
    departamento_del_usuario = session.get('departamento')

    if not departamento_del_usuario:
        return jsonify({"message": "No autorizado"}), 401

    try:
        # Lógica para el departamento EMISOR (solo puede modificar descripción y destino)
        if departamento_del_usuario == solicitud.dependencia:
            if 'descripcion' in data:
                solicitud.descripcion = data['descripcion']
            if 'departamento_destino' in data:
                solicitud.departamento_destino = data['departamento_destino']
            # Ignorar otros campos si son enviados por el emisor
            
        # Lógica para el departamento RECEPTOR (solo puede modificar estado, quien_atendio, que_hizo)
        elif departamento_del_usuario == solicitud.departamento_destino:
            if 'estado' in data:
                solicitud.status = data['estado']
            if 'quien_atendio' in data:
                solicitud.quien_atendio = data['quien_atendio']
            if 'que_hizo' in data:
                solicitud.que_hizo = data['que_hizo']
            # Ignorar otros campos si son enviados por el receptor
        else:
            return jsonify({"message": "No tienes permiso para modificar esta tarea."}), 403

        db.session.commit()
        return jsonify({"message": "Tarea actualizada con éxito"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": "Error al actualizar la tarea", "error": str(e)}), 400

@app.route('/api/solicitudes/<int:id>', methods=['DELETE'])
def delete_solicitud(id):
    solicitud = Solicitud.query.get_or_404(id)
    # Opcional: Añadir aquí una verificación de permisos si solo el emisor puede eliminar
    try:
        db.session.delete(solicitud)
        db.session.commit()
        return jsonify({"message": "Tarea eliminada con éxito"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": "Error al eliminar la tarea", "error": str(e)}), 400

# Endpoint para crear el PDF (IMPLEMENTACION COMPLETA)
@app.route('/api/export-pdf', methods=['POST'])
def export_pdf():
    data = request.get_json()
    export_all = data.get('export_all', False)
    ids_to_export = data.get('ids', [])

    if export_all:
        solicitudes = Solicitud.query.all()
    elif ids_to_export:
        solicitudes = Solicitud.query.filter(Solicitud.id.in_(ids_to_export)).all()
    else:
        return jsonify({"message": "No se especificaron solicitudes para exportar."}), 400

    # Crear el objeto BytesIO para guardar el PDF en memoria
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter

    styles = getSampleStyleSheet()
    h1 = styles['h1']
    h2 = styles['h2']
    normal = styles['Normal']
    
    # Estilo para párrafos largos con ajuste de texto
    long_text_style = ParagraphStyle(
        name='LongText',
        parent=normal,
        wordWrap='CJK', # Permite el ajuste de palabras en el texto
        alignment=0, # Izquierda
        leading=14 # Espacio entre líneas
    )

    y_position = height - 50
    margin = 50

    c.setFont('Helvetica-Bold', 18)
    c.drawString(margin, y_position, "Reporte de Solicitudes FUNDACITE")
    y_position -= 30

    c.setFont('Helvetica', 10)
    c.drawString(margin, y_position, f"Fecha de generación: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    y_position -= 20

    if not solicitudes:
        c.drawString(margin, y_position, "No hay solicitudes para mostrar en este reporte.")
    else:
        for solicitud in solicitudes:
            if y_position < 100: # Si queda poco espacio, añadir nueva página
                c.showPage()
                y_position = height - 50
                c.setFont('Helvetica-Bold', 18)
                c.drawString(margin, y_position, "Reporte de Solicitudes (Continuación)")
                y_position -= 30

            c.setFont('Helvetica-Bold', 12)
            c.drawString(margin, y_position, f"Solicitud ID: {solicitud.id}")
            y_position -= 15

            # Convertir fecha a formato legible
            fecha_creacion_str = solicitud.fecha_creacion.strftime('%Y-%m-%d %H:%M:%S')

            details = [
                f"Cédula: {solicitud.cedula}",
                f"Nombre: {solicitud.nombre}",
                f"Dpto. Emisor: {solicitud.dependencia}",
                f"Tipo: {solicitud.tipo}",
                f"Dpto. Destino: {solicitud.departamento_destino}",
                f"Fecha de Creación: {fecha_creacion_str}",
                f"Estado: {solicitud.status}",
                f"Quien Atendió: {solicitud.quien_atendio if solicitud.quien_atendio else 'N/A'}"
            ]
            
            for detail in details:
                c.drawString(margin + 10, y_position, detail)
                y_position -= 15

            # Descripción y Resolución con ajuste de texto (Paragraph)
            y_position -= 5 # Pequeño espacio extra
            c.setFont('Helvetica-Bold', 10)
            c.drawString(margin + 10, y_position, "Descripción:")
            y_position -= 15
            desc_paragraph = Paragraph(solicitud.descripcion, long_text_style)
            # Calcular altura del párrafo para posicionarlo correctamente
            desc_width = width - 2 * margin - 20 # Ancho disponible
            desc_height = desc_paragraph.wrapOn(c, desc_width, height)[1]
            desc_paragraph.drawOn(c, margin + 10, y_position - desc_height)
            y_position -= (desc_height + 10) # Mover la posición Y después de dibujar el párrafo

            if solicitud.que_hizo:
                c.setFont('Helvetica-Bold', 10)
                c.drawString(margin + 10, y_position, "Resolución:")
                y_position -= 15
                res_paragraph = Paragraph(solicitud.que_hizo, long_text_style)
                res_width = width - 2 * margin - 20
                res_height = res_paragraph.wrapOn(c, res_width, height)[1]
                res_paragraph.drawOn(c, margin + 10, y_position - res_height)
                y_position -= (res_height + 20) # Mover la posición Y y añadir más espacio

            else:
                c.setFont('Helvetica-Bold', 10)
                c.drawString(margin + 10, y_position, "Resolución: N/A")
                y_position -= 20


            y_position -= 10 # Espacio entre solicitudes
            c.line(margin, y_position, width - margin, y_position) # Línea separadora
            y_position -= 20 # Espacio después de la línea

    c.save() # Guarda el contenido del canvas en el buffer

    buffer.seek(0) # Vuelve al inicio del buffer
    return send_file(buffer, as_attachment=True, download_name='reporte_solicitudes.pdf', mimetype='application/pdf')


# Rutas que renderizan los archivos HTML (usando render_template)
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/login')
def login_page():
    return render_template('login.html')

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        # Crear usuarios por defecto para cada departamento si no existen
        for dep in DEPARTAMENTOS:
            username_lower = dep.lower()
            if not User.query.filter_by(username=username_lower).first():
                new_user = User(username=username_lower, departamento=dep)
                new_user.set_password("fundacite")
                db.session.add(new_user)
                print(f"Usuario '{username_lower}' creado para el departamento '{dep}'")
        db.session.commit()
    app.run(debug=True, host='0.0.0.0', port=5000) # Asegúrate de que host='0.0.0.0' esté aquí