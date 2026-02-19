import json
import os
import sqlite3
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

DB_PATH = os.path.join(os.path.dirname(__file__), 'data.db')
BASE_DIR = os.path.dirname(__file__)

STATIC_PARAMS = [
    {"name": "param_Consol", "value": "USD", "isStatic": True},
    {"name": "Param_Store_Entities", "value": "STORE_REG", "isStatic": True},
    {"name": "Param_Time", "value": "|!Param_Time_Input!|", "isStatic": True},
]


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS packages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                package_name TEXT NOT NULL,
                distribution_group TEXT,
                delivery_type TEXT,
                email_title TEXT,
                email_message TEXT,
                location TEXT
            );
            CREATE TABLE IF NOT EXISTS package_contents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                package_id INTEGER NOT NULL,
                file_path TEXT,
                output_filename TEXT,
                access_group TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY(package_id) REFERENCES packages(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS package_parameters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                package_id INTEGER NOT NULL,
                param_name TEXT NOT NULL,
                literal_value TEXT,
                is_static INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY(package_id) REFERENCES packages(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS distributions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                distribution_name TEXT NOT NULL,
                is_public INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS distribution_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                distribution_id INTEGER NOT NULL,
                username TEXT,
                alternate_email TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY(distribution_id) REFERENCES distributions(id) ON DELETE CASCADE
            );
            """
        )


def package_by_id(conn, package_id):
    package = conn.execute("SELECT * FROM packages WHERE id = ?", (package_id,)).fetchone()
    if not package:
        return None
    contents = conn.execute(
        "SELECT id, file_path, output_filename, access_group, enabled FROM package_contents WHERE package_id = ?",
        (package_id,),
    ).fetchall()
    parameters = conn.execute(
        "SELECT id, param_name, literal_value, is_static FROM package_parameters WHERE package_id = ?",
        (package_id,),
    ).fetchall()
    return {
        "id": package["id"],
        "packageName": package["package_name"],
        "distributionGroup": package["distribution_group"],
        "deliveryType": package["delivery_type"],
        "emailTitle": package["email_title"],
        "emailMessage": package["email_message"],
        "location": package["location"],
        "contents": [
            {
                "id": c["id"],
                "filePath": c["file_path"],
                "outputFilename": c["output_filename"],
                "accessGroup": c["access_group"],
                "enabled": bool(c["enabled"]),
            }
            for c in contents
        ],
        "parameters": [
            {
                "id": p["id"],
                "name": p["param_name"],
                "value": p["literal_value"],
                "isStatic": bool(p["is_static"]),
            }
            for p in parameters
        ],
    }


def distribution_by_id(conn, distribution_id):
    distribution = conn.execute("SELECT * FROM distributions WHERE id = ?", (distribution_id,)).fetchone()
    if not distribution:
        return None
    users = conn.execute(
        "SELECT id, username, alternate_email, enabled FROM distribution_users WHERE distribution_id = ?",
        (distribution_id,),
    ).fetchall()
    return {
        "id": distribution["id"],
        "distributionName": distribution["distribution_name"],
        "isPublic": "enabled" if distribution["is_public"] else "disabled",
        "users": [
            {
                "id": u["id"],
                "user": u["username"],
                "alternateEmail": u["alternate_email"],
                "enabled": bool(u["enabled"]),
            }
            for u in users
        ],
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def _send_json(self, payload, status=HTTPStatus.OK):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self):
        length = int(self.headers.get('Content-Length', '0'))
        raw = self.rfile.read(length) if length else b'{}'
        return json.loads(raw.decode('utf-8') or '{}')

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/packages':
            with get_conn() as conn:
                ids = conn.execute('SELECT id FROM packages ORDER BY id').fetchall()
                payload = [package_by_id(conn, row['id']) for row in ids]
            return self._send_json(payload)
        if parsed.path == '/api/distributions':
            with get_conn() as conn:
                ids = conn.execute('SELECT id FROM distributions ORDER BY id').fetchall()
                payload = [distribution_by_id(conn, row['id']) for row in ids]
            return self._send_json(payload)
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        body = self._read_json()
        if parsed.path == '/api/packages':
            with get_conn() as conn:
                cursor = conn.execute(
                    """
                    INSERT INTO packages (package_name, distribution_group, delivery_type, email_title, email_message, location)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        body.get('packageName', ''),
                        body.get('distributionGroup', ''),
                        body.get('deliveryType', ''),
                        body.get('emailTitle', ''),
                        body.get('emailMessage', ''),
                        body.get('location', ''),
                    ),
                )
                package_id = cursor.lastrowid
                for content in body.get('contents', []):
                    conn.execute(
                        """
                        INSERT INTO package_contents (package_id, file_path, output_filename, access_group, enabled)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            package_id,
                            content.get('filePath', ''),
                            content.get('outputFilename', ''),
                            content.get('accessGroup', ''),
                            1 if content.get('enabled', False) else 0,
                        ),
                    )
                for param in (body.get('parameters') or STATIC_PARAMS):
                    conn.execute(
                        """
                        INSERT INTO package_parameters (package_id, param_name, literal_value, is_static)
                        VALUES (?, ?, ?, ?)
                        """,
                        (
                            package_id,
                            param.get('name', ''),
                            param.get('value', ''),
                            1 if param.get('isStatic', True) else 0,
                        ),
                    )
                payload = package_by_id(conn, package_id)
            return self._send_json(payload, HTTPStatus.CREATED)

        if parsed.path == '/api/distributions':
            with get_conn() as conn:
                cursor = conn.execute(
                    'INSERT INTO distributions (distribution_name, is_public) VALUES (?, ?)',
                    (body.get('distributionName', ''), 0 if body.get('isPublic') == 'disabled' else 1),
                )
                distribution_id = cursor.lastrowid
                for user in body.get('users', []):
                    conn.execute(
                        """
                        INSERT INTO distribution_users (distribution_id, username, alternate_email, enabled)
                        VALUES (?, ?, ?, ?)
                        """,
                        (
                            distribution_id,
                            user.get('user', ''),
                            user.get('alternateEmail', ''),
                            1 if user.get('enabled', False) else 0,
                        ),
                    )
                payload = distribution_by_id(conn, distribution_id)
            return self._send_json(payload, HTTPStatus.CREATED)

        return self._send_json({'error': 'Not found'}, HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        parsed = urlparse(self.path)
        body = self._read_json()
        package_prefix = '/api/packages/'
        distribution_prefix = '/api/distributions/'

        if parsed.path.startswith(package_prefix):
            package_id = int(parsed.path.removeprefix(package_prefix))
            with get_conn() as conn:
                exists = conn.execute('SELECT 1 FROM packages WHERE id = ?', (package_id,)).fetchone()
                if not exists:
                    return self._send_json({'error': 'Package not found'}, HTTPStatus.NOT_FOUND)
                conn.execute(
                    """
                    UPDATE packages
                    SET package_name = ?, distribution_group = ?, delivery_type = ?, email_title = ?, email_message = ?, location = ?
                    WHERE id = ?
                    """,
                    (
                        body.get('packageName', ''),
                        body.get('distributionGroup', ''),
                        body.get('deliveryType', ''),
                        body.get('emailTitle', ''),
                        body.get('emailMessage', ''),
                        body.get('location', ''),
                        package_id,
                    ),
                )
                conn.execute('DELETE FROM package_contents WHERE package_id = ?', (package_id,))
                conn.execute('DELETE FROM package_parameters WHERE package_id = ?', (package_id,))
                for content in body.get('contents', []):
                    conn.execute(
                        """
                        INSERT INTO package_contents (package_id, file_path, output_filename, access_group, enabled)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            package_id,
                            content.get('filePath', ''),
                            content.get('outputFilename', ''),
                            content.get('accessGroup', ''),
                            1 if content.get('enabled', False) else 0,
                        ),
                    )
                for param in (body.get('parameters') or STATIC_PARAMS):
                    conn.execute(
                        """
                        INSERT INTO package_parameters (package_id, param_name, literal_value, is_static)
                        VALUES (?, ?, ?, ?)
                        """,
                        (
                            package_id,
                            param.get('name', ''),
                            param.get('value', ''),
                            1 if param.get('isStatic', True) else 0,
                        ),
                    )
                payload = package_by_id(conn, package_id)
            return self._send_json(payload)

        if parsed.path.startswith(distribution_prefix):
            distribution_id = int(parsed.path.removeprefix(distribution_prefix))
            with get_conn() as conn:
                exists = conn.execute('SELECT 1 FROM distributions WHERE id = ?', (distribution_id,)).fetchone()
                if not exists:
                    return self._send_json({'error': 'Distribution not found'}, HTTPStatus.NOT_FOUND)
                conn.execute(
                    'UPDATE distributions SET distribution_name = ?, is_public = ? WHERE id = ?',
                    (body.get('distributionName', ''), 0 if body.get('isPublic') == 'disabled' else 1, distribution_id),
                )
                conn.execute('DELETE FROM distribution_users WHERE distribution_id = ?', (distribution_id,))
                for user in body.get('users', []):
                    conn.execute(
                        """
                        INSERT INTO distribution_users (distribution_id, username, alternate_email, enabled)
                        VALUES (?, ?, ?, ?)
                        """,
                        (
                            distribution_id,
                            user.get('user', ''),
                            user.get('alternateEmail', ''),
                            1 if user.get('enabled', False) else 0,
                        ),
                    )
                payload = distribution_by_id(conn, distribution_id)
            return self._send_json(payload)

        return self._send_json({'error': 'Not found'}, HTTPStatus.NOT_FOUND)


if __name__ == '__main__':
    init_db()
    server = ThreadingHTTPServer(('0.0.0.0', 3000), Handler)
    print('Server running on http://localhost:3000')
    server.serve_forever()
