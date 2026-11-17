CREATE DATABASE IF NOT EXISTS aeropuerto CHARACTER SET utf8mb4; --
USE aeropuerto;

-- CATÁLOGOS

CREATE TABLE pais (
	id_pais INT PRIMARY KEY NOT NULL auto_increment,
    codigo_iso CHAR(2) UNIQUE KEY NOT NULL,
    nombre VARCHAR(50) NOT NULL
);

CREATE TABLE aeropuerto (
	id_aeropuerto INT PRIMARY KEY NOT NULL auto_increment,
    codigo_iata CHAR(3) UNIQUE KEY NOT NULL,
    codigo_icao CHAR(4) UNIQUE KEY NOT NULL,
    nombre VARCHAR(50) NOT NULL,
    ciudad VARCHAR(50) NOT NULL,
    id_pais INT NOT NULL,
    latitud float NOT NULL,
    longitud FLOAT NOT NULL,
	zona_horaria varchar(50),

    FOREIGN KEY (id_pais) REFERENCES pais(id_pais)

);

CREATE TABLE aerolinea (
    id_aerolinea INT PRIMARY KEY AUTO_INCREMENT,
    codigo_iata  CHAR(2) NOT NULL,
    nombre       VARCHAR(50) NOT NULL,
    codigo_icao  CHAR(3) NULL,
    indicativo   VARCHAR(50) NULL,
    id_pais      INT NOT NULL,
    activa       TINYINT(1) NOT NULL DEFAULT 1,

    CONSTRAINT uq_aerolinea_iata UNIQUE (codigo_iata),
    CONSTRAINT chk_aerolinea_activa CHECK (activa IN (0, 1)),
    CONSTRAINT fk_aerolinea_pais FOREIGN KEY (id_pais) REFERENCES pais(id_pais)
);

CREATE TABLE modelo_aeronave (
	id_modelo INT PRIMARY KEY NOT NULL auto_increment,
    fabricante VARCHAR(50) NOT NULL,
    nombre VARCHAR(50) NOT NULL,
    capacidad_total INT NOT NULL,
    autonomia_km INT NOT NULL,

    UNIQUE KEY uq_modelo (fabricante, nombre),
    CONSTRAINT chk_modelo_valores CHECK (capacidad_total > 0 AND autonomia_km > 0)
);

CREATE TABLE aeronave (
	id_aeronave INT PRIMARY KEY NOT NULL auto_increment,
    matricula VARCHAR(10) UNIQUE KEY NOT NULL,
    id_modelo INT NOT NULL,
    id_aerolinea INT NOT NULL,
    estado ENUM('operativa','mantenimiento','retirada') NOT NULL DEFAULT 'operativa',

    FOREIGN KEY (id_modelo) REFERENCES modelo_aeronave(id_modelo),
    FOREIGN KEY (id_aerolinea) REFERENCES aerolinea(id_aerolinea)
);

CREATE TABLE clase_cabina (
	id_clase INT PRIMARY KEY NOT NULL auto_increment,
    nombre VARCHAR(30) UNIQUE KEY NOT NULL
);

-- INFRAESTRUCTURA

CREATE TABLE terminal(
	id_terminal INT PRIMARY KEY NOT NULL auto_increment,
    id_aeropuerto INT NOT NULL,
    nombre VARCHAR(50) NOT NULL,

    FOREIGN KEY (id_aeropuerto) REFERENCES aeropuerto(id_aeropuerto)
);

CREATE TABLE puerta_embarque (
	id_puerta INT PRIMARY KEY NOT NULL auto_increment,
    id_terminal INT NOT NULL,
    codigo VARCHAR(10) NOT NULL,

    UNIQUE KEY uq_puerta (id_terminal, codigo),
    FOREIGN KEY (id_terminal) REFERENCES terminal(id_terminal)
);

CREATE TABLE pista (
	id_pista INT PRIMARY KEY NOT NULL AUTO_INCREMENT,
    id_aeropuerto INT NOT NULL,
    designacion VARCHAR(50) NOT NULL,
    longitud_m INT NOT NULL,

    FOREIGN KEY (id_aeropuerto) REFERENCES aeropuerto(id_aeropuerto)
);

-- OPERACIONES

CREATE TABLE ruta (
	id_ruta INT PRIMARY KEY NOT NULL auto_increment,
    id_aeropuerto_origen INT NOT NULL,
    id_aeropuerto_destino INT NOT NULL,
    distancia_km INT NOT NULL,

    UNIQUE KEY uq_ruta (id_aeropuerto_origen, id_aeropuerto_destino),
    CONSTRAINT chk_ruta_distinta CHECK (id_aeropuerto_origen <> id_aeropuerto_destino), 
    CONSTRAINT chk_ruta_distancia CHECK (distancia_km > 0), 
    FOREIGN KEY (id_aeropuerto_origen) REFERENCES aeropuerto(id_aeropuerto),
    FOREIGN KEY (id_aeropuerto_destino) REFERENCES aeropuerto(id_aeropuerto)
);

CREATE TABLE vuelo (
	id_vuelo INT PRIMARY KEY NOT NULL auto_increment,
    numero_vuelo VARCHAR(10) NOT NULL,
    id_ruta INT NOT NULL,
    id_aeronave INT NOT NULL,
    id_puerta INT NULL,
    id_pista INT NULL,
    salida_prevista DATETIME NOT NULL,
    llegada_prevista DATETIME NOT NULL,
    salida_real DATETIME NULL,
    llegada_real DATETIME NULL,
    estado ENUM('programado','embarcando','en_vuelo','aterrizado','retrasado','cancelado') NOT NULL DEFAULT 'programado',

    UNIQUE KEY uq_vuelo (numero_vuelo, salida_prevista),
    INDEX idx_vuelo_aeronave_salida (id_aeronave, salida_prevista),
    INDEX idx_vuelo_puerta_salida (id_puerta, salida_prevista),
    INDEX idx_vuelo_pista_salida (id_pista, salida_prevista),
    INDEX idx_vuelo_salida (salida_prevista),
    CONSTRAINT chk_vuelo_horas CHECK (llegada_prevista > salida_prevista),
    FOREIGN KEY (id_ruta) REFERENCES ruta(id_ruta),
    FOREIGN KEY (id_aeronave) REFERENCES aeronave(id_aeronave),
    FOREIGN KEY (id_puerta) REFERENCES puerta_embarque(id_puerta),
    FOREIGN KEY (id_pista) REFERENCES pista(id_pista)
);

CREATE TABLE evento_vuelo (
	id_evento BIGINT NOT NULL auto_increment,
    id_vuelo INT NOT NULL,
    tipo_evento VARCHAR(30) NOT NULL,
    fecha_hora DATETIME NOT NULL,

    PRIMARY KEY (id_evento),
    INDEX idx_evento_vuelo (id_vuelo, fecha_hora),
    CONSTRAINT fk_evento_vuelo_vuelo FOREIGN KEY (id_vuelo) REFERENCES vuelo (id_vuelo)
);

-- PERSONAL

CREATE TABLE empleado (
	id_empleado INT PRIMARY KEY NOT NULL auto_increment,
    nombre VARCHAR(50) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    rol ENUM('piloto','copiloto','tcp','mecanico') NOT NULL,
    licencia VARCHAR(30) UNIQUE KEY,
    id_aerolinea INT NOT NULL,

    FOREIGN KEY (id_aerolinea) REFERENCES aerolinea(id_aerolinea)
);

CREATE TABLE tripulacion_vuelo (
	id_vuelo INT NOT NULL,
    id_empleado INT NOT NULL,
    funcion ENUM('comandante','copiloto','jefe_cabina','tcp') NOT NULL,

    PRIMARY KEY (id_vuelo, id_empleado),
    FOREIGN KEY (id_vuelo) REFERENCES vuelo(id_vuelo),
    FOREIGN KEY (id_empleado) REFERENCES empleado(id_empleado)
);

-- PASAJEROS Y VENTAS

CREATE TABLE pasajero (
	id_pasajero INT PRIMARY KEY NOT NULL auto_increment,
    nombre VARCHAR(50) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    documento VARCHAR(20) UNIQUE KEY NOT NULL,
    fecha_nacimiento DATE NOT NULL,
    id_pais INT NOT NULL,
    email VARCHAR(100),

    FOREIGN KEY (id_pais) REFERENCES pais(id_pais)
);

CREATE TABLE reserva (
	id_reserva INT PRIMARY KEY NOT NULL auto_increment,
    localizador CHAR(6) UNIQUE KEY NOT NULL,
    id_pasajero_titular INT NOT NULL,
    fecha_reserva DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado ENUM('pendiente','confirmada','cancelada') NOT NULL DEFAULT 'pendiente',
    importe_total DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT chk_reserva_importe CHECK (importe_total >= 0),
    FOREIGN KEY (id_pasajero_titular) REFERENCES pasajero(id_pasajero)
);

CREATE TABLE billete (
	id_billete INT PRIMARY KEY NOT NULL auto_increment,
    id_reserva INT NOT NULL,
    id_pasajero INT NOT NULL,
    id_vuelo INT NOT NULL,
    id_clase INT NOT NULL,
    asiento VARCHAR(4) NULL,
    precio DECIMAL(8,2) NOT NULL,
    estado ENUM('emitido','checkin','embarcado','cancelado') NOT NULL DEFAULT 'emitido',

    UNIQUE KEY uq_billete_asiento (id_vuelo, asiento),
    UNIQUE KEY uq_billete_pasajero_vuelo (id_vuelo, id_pasajero),
    CONSTRAINT chk_billete_precio CHECK (precio >= 0),
    FOREIGN KEY (id_reserva) REFERENCES reserva(id_reserva),
    FOREIGN KEY (id_pasajero) REFERENCES pasajero(id_pasajero),
    FOREIGN KEY (id_vuelo) REFERENCES vuelo(id_vuelo),
    FOREIGN KEY (id_clase) REFERENCES clase_cabina(id_clase)
);

CREATE TABLE tarjeta_embarque (
	id_embarque INT PRIMARY KEY NOT NULL auto_increment,
    id_billete INT UNIQUE KEY NOT NULL,
    fecha_checkin DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    hora_embarque DATETIME NULL,

    FOREIGN KEY (id_billete) REFERENCES billete(id_billete)
);

CREATE TABLE equipaje (
	id_equipaje INT PRIMARY KEY NOT NULL auto_increment,
    id_billete INT NOT NULL,
    peso_kg DECIMAL(5,2) NOT NULL,
    estado ENUM('facturado','cargado','en_cinta','perdido') NOT NULL DEFAULT 'facturado',

    CONSTRAINT chk_equipaje_peso CHECK (peso_kg > 0),
    FOREIGN KEY (id_billete) REFERENCES billete(id_billete)
);

-- MANTENIMIENTO E INCIDENCIAS

CREATE TABLE mantenimiento (
	id_mantenimiento INT PRIMARY KEY NOT NULL auto_increment,
    id_aeronave INT NOT NULL,
    tipo VARCHAR(50) NOT NULL,
    fecha_inicio DATETIME NOT NULL,
    fecha_fin DATETIME NULL,
    coste DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT chk_mant_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
    CONSTRAINT chk_mant_coste CHECK (coste >= 0),
    FOREIGN KEY (id_aeronave) REFERENCES aeronave(id_aeronave)
);

CREATE TABLE incidencia (
	id_incidencia INT PRIMARY KEY NOT NULL auto_increment,
    id_vuelo INT NOT NULL,
    tipo VARCHAR(50) NOT NULL,id_aerolinea
    gravedad ENUM('baja','media','alta','critica') NOT NULL,
    descripcion TEXT,
    fecha_hora DATETIME NOT NULL,

    FOREIGN KEY (id_vuelo) REFERENCES vuelo(id_vuelo)
);