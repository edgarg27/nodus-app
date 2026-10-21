# App móvil de Nodus (clientes)

App para **App Store** y **Google Play** hecha con [Capacitor](https://capacitorjs.com). Es una app nativa que abre
`https://app.nodusbc.mx` (la misma web), así que **cada cambio que se despliega en la web aparece solo en la app**,
sin volver a publicarla. Solo hay que publicar una versión nueva cuando cambia algo nativo (íconos, permisos,
plugins, versión de Capacitor).

- Identificador: `mx.nodusbc.app` · Nombre: **Nodus**
- Configuración: `capacitor.config.json` (abre `/login`; si no hay internet muestra `www/sin-conexion.html`)
- Lo nativo que usa: pantalla de inicio, barra de estado azul, botón "atrás" de Android y **avisos push**
  (Android por Firebase, iPhone por Apple). Subir comprobantes con la cámara o las fotos funciona con el mismo
  botón de la web.
- La web sabe que está dentro de la app con `lib/appNativa.ts` (no muestra "instalar app" y usa los avisos nativos).

## Comandos (dentro de `mobile/`)

```
npm install          # una vez
npx cap sync         # después de cambiar capacitor.config.json o plugins
npx cap open android # abre el proyecto en Android Studio
npx cap open ios     # abre el proyecto en Xcode (solo en Mac)
```

Íconos y pantalla de inicio: las imágenes fuente están en `assets/` y se regeneran con
`npx @capacitor/assets@3.0.5 generate --android --ios --iconBackgroundColor "#0d1b3e" --splashBackgroundColor "#0d1b3e"`.
Para la versión final conviene reemplazar `assets/icon-only.png` por el logo en alta resolución (1024×1024).

## Android

1. Instalar **Android Studio** (trae Java y el SDK).
2. **Firebase** (avisos push): crear el proyecto en https://console.firebase.google.com, agregar una app Android
   con el paquete `mx.nodusbc.app`, descargar `google-services.json` y ponerlo en `android/app/` (no se sube a git).
3. `npx cap open android` → Run para probar en un celular, o **Build → Generate Signed App Bundle** para la tienda.
   La llave de firma (`.jks`) se guarda fuera del repositorio y con respaldo: sin ella no se pueden publicar
   actualizaciones.
4. Google Play Console (US$25, un solo pago) → crear la app → subir el `.aab`.

## iPhone (necesita una Mac con Xcode, o un servicio de compilación en la nube)

1. Cuenta **Apple Developer** (US$99 al año; como empresa pide el número D-U-N-S de NBC COMPANY).
2. `npx cap open ios` → en *Signing & Capabilities* elegir el equipo, y agregar **Push Notifications** y
   **Background Modes → Remote notifications**.
3. En developer.apple.com → Keys: crear una llave **APNs** (.p8). Anotar su Key ID y el Team ID.
4. Product → Archive → subir a App Store Connect → TestFlight para probar → enviar a revisión.

## Variables del servidor para los avisos push (`/opt/nodus/.env`)

```
# Android (Firebase → Configuración del proyecto → Cuentas de servicio → Generar clave privada)
FIREBASE_SERVICE_ACCOUNT=<el JSON completo, o en base64>

# iPhone (llave APNs .p8)
APNS_KEY=<contenido del .p8, o en base64>
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_BUNDLE_ID=mx.nodusbc.app
APNS_PRODUCCION=1   # quitarla para probar con apps instaladas desde Xcode (sandbox)
```

Antes de usarlos hay que correr `migracion_push_nativo.sql` (tabla `push_dispositivos`). Sin estas variables la app
funciona igual, solo no llegan los avisos al celular.

## Para la revisión de las tiendas

- Cuenta de prueba de cliente (usuario y contraseña) para que el revisor entre.
- Aviso de privacidad publicado en una URL (pendiente de aprobación del abogado).
- Capturas de pantalla del celular y descripción de la app.
- Los pagos en línea siguen en "Próximamente": la app no cobra nada, así que no aplica la regla de compras dentro de
  la app de Apple (los servicios físicos como renta de oficinas no la requieren de todos modos).
