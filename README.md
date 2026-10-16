# LinkedIn Job Filter — Bloquear empresas

Extensión de **Google Chrome (Manifest V3)** en JavaScript y CSS puro, sin backend, que añade un botón **«Bloquear empresa»** junto a cada oferta o tarjeta de empleo en LinkedIn. Al usarlo, la empresa queda en una lista negra local y la extensión **oculta automáticamente** todas las ofertas futuras de esa empresa — incluidas las cargadas al hacer scroll — mediante `MutationObserver`.

> **Importante sobre anuncios:** la extensión puede ocultar en el cliente ofertas promocionadas/patrocinadas de empresas bloqueadas, pero **no puede impedir** que LinkedIn sirva anuncios. Solo actúa sobre el DOM del navegador.

---

## Descripción y objetivos

### Qué hace

- Detecta tarjetas/ofertas de empleo en páginas de LinkedIn Jobs.
- Muestra un botón discreto **«Bloquear empresa»** por oferta.
- Guarda la empresa en `chrome.storage` (local al navegador).
- Oculta de inmediato y en el futuro todas las ofertas de empresas en la lista negra.
- Permite gestionar, desbloquear, importar y exportar la lista desde el popup (y, más adelante, desde una página de opciones).

### Objetivos

| Objetivo | Descripción |
| --- | --- |
| Control del usuario | Decidir qué empresas no quiere ver en resultados de empleo |
| Persistencia local | Lista negra solo en el navegador; sin servidor |
| Resiliencia | Seguir funcionando ante cambios moderados del DOM de LinkedIn |
| Privacidad | Solo permiso de host en `linkedin.com`; ningún dato sale del equipo |
| UX clara | Botón visible sin romper el layout; comportamiento de ocultación entendible |

### No objetivos (fuera de alcance)

- Modificar, eliminar o bloquear peticiones de red de LinkedIn.
- Scraping masivo, automatización de candidaturas o bots.
- Sincronización en la nube entre dispositivos (salvo lo que Chrome ofrezca nativamente con `storage.sync` en fases posteriores, si se decide).
- Sustituir filtros nativos de LinkedIn.

---

## Alcance

### MVP (fase inicial)

- [x] Plan del proyecto (este documento)
- [x] Manifest V3 + content script + estilos + popup
- [x] Botón «Bloquear empresa» en resultados de búsqueda de empleos
- [x] Persistencia de la lista negra en `chrome.storage.local`
- [x] Ocultación automática de ofertas de empresas bloqueadas
- [x] Soporte de contenido cargado dinámicamente (`MutationObserver`)
- [x] Popup para ver la lista y desbloquear empresas
- [x] Ocultación client-side de ofertas promocionadas de empresas bloqueadas (sin bloquear la entrega de ads)

### Más adelante (post-MVP)

- [ ] Página de opciones (`options.html`) con preferencias avanzadas
- [ ] Importar / exportar lista negra (JSON)
- [ ] Preferencia UX: ocultar por completo vs. colapsar con «Mostrar»
- [ ] Cobertura de `/jobs/collections` y panel de detalle de empleo
- [ ] Cobertura experimental de posts de empleo en el feed
- [ ] Uso de `chrome.storage.sync` (opcional, con límites de cuota)
- [ ] Contador de ofertas ocultas en la sesión
- [ ] Internacionalización (i18n) de la UI de la extensión
- [ ] Publicación en Chrome Web Store

### Páginas de LinkedIn cubiertas

| Página / contexto | Prioridad | Notas |
| --- | --- | --- |
| Búsqueda de empleos `/jobs/search` | MVP | Lista de tarjetas + scroll infinito |
| Colecciones `/jobs/collections/*` | Post-MVP temprano | Misma lógica de tarjetas, selectores pueden diferir |
| Panel / vista de detalle de empleo | Post-MVP temprano | Botón en cabecera de la oferta abierta |
| Posts de empleo en el feed (`/feed`) | Más adelante | Selectores distintos; menor prioridad |
| Otras rutas (`/jobs/view/...` standalone, etc.) | Evaluar | Incluir si reutilizan markup similar |

---

## Arquitectura y estructura de archivos

Extensión **solo cliente**: content script inyectado en páginas de LinkedIn + UI de popup. Sin service worker obligatorio para la lógica principal (puede usarse un SW mínimo si Manifest V3 lo exige para el ciclo de vida; la lógica de filtrado vive en el content script).

```
linkedin-job-filter/
├── README.md                 # Este plan
├── manifest.json             # Manifest V3
├── content.js                # Detección, botón, MutationObserver, ocultación
├── styles.css                # Estilos del botón y estados oculto/colapsado
├── popup.html                # UI para gestionar la lista negra
├── popup.js                  # Leer/escribir storage, desbloquear
├── options.html              # (post-MVP) Preferencias
├── options.js                # (post-MVP)
├── lib/
│   ├── storage.js            # API de lectura/escritura de la blocklist
│   ├── company.js            # Normalización de claves de empresa
│   └── selectors.js          # Selectores centralizados + fallbacks
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── test/
    ├── fixture.html          # Página local que simula tarjetas de empleo
    └── company.test.js       # Checks de normalización de claves (Node)
```

### Responsabilidades

| Archivo | Rol |
| --- | --- |
| `manifest.json` | Permisos, `content_scripts` (matches LinkedIn), popup, iconos |
| `content.js` | Observar DOM, inyectar botones, aplicar filtros, reaccionar a storage |
| `styles.css` | Apariencia del botón; clase `.ljf-hidden` / `.ljf-collapsed` |
| `popup.*` | Listar empresas bloqueadas, desbloquear, import/export |
| `lib/selectors.js` | Único lugar con selectores CSS/DOM (facilita mantenimiento) |
| `lib/company.js` | Extraer y normalizar ID/URL/nombre de empresa |
| `lib/storage.js` | Abstracción sobre `chrome.storage.local` |

### Flujo de datos (alto nivel)

```
LinkedIn DOM ──► content.js (detecta tarjetas)
                     │
                     ├─► inyecta botón «Bloquear empresa»
                     ├─► al clic: normaliza clave ──► chrome.storage.local
                     └─► MutationObserver / storage.onChanged
                              └─► oculta tarjetas de empresas bloqueadas

popup.js ◄──► chrome.storage.local  (gestión / desbloqueo / import-export)
```

---

## Modelo de datos (`chrome.storage`)

Almacenamiento preferido en MVP: **`chrome.storage.local`**.

### Claves de storage

| Clave | Tipo | Descripción |
| --- | --- | --- |
| `blockedCompanies` | `object` (mapa) | Empresas bloqueadas indexadas por clave normalizada |
| `settings` | `object` | Preferencias de UX (modo ocultar, etc.) |
| `schemaVersion` | `number` | Versión del esquema para migraciones futuras |

### Entrada de empresa bloqueada

```json
{
  "key": "company:12345678",
  "companyId": "12345678",
  "companyUrl": "https://www.linkedin.com/company/acme/",
  "displayName": "Acme Corp",
  "blockedAt": "2026-10-16T12:00:00.000Z",
  "source": "job-card"
}
```

### Normalización de claves (preferencia)

1. **ID de empresa** (si está en el DOM o en la URL `/company/{id}` o slug resoluble) → `company:{id}`
2. **URL canónica de empresa** (pathname normalizado, sin query/fragment, minúsculas) → `url:{pathname}`
3. **Nombre** (solo fallback) → `name:{nombre-normalizado}`  
   - Normalizar: trim, minúsculas, colapsar espacios, quitar puntuación superficial  
   - Documentar que el nombre es frágil (homónimos, renombres, i18n)

Al bloquear, guardar **todos los identificadores disponibles** en el objeto, aunque la clave primaria sea la más fuerte. Al filtrar, comprobar coincidencia por ID, luego URL, luego nombre.

### Preferencias (`settings`)

```json
{
  "hideMode": "remove",
  "hidePromoted": true,
  "showBlockButton": true
}
```

- `hideMode`: `"remove"` (ocultar por completo) \| `"collapse"` (colapsar con enlace «Mostrar»)
- `hidePromoted`: ocultar también ofertas marcadas como promocionadas de empresas bloqueadas
- `showBlockButton`: mostrar u ocultar el botón en las tarjetas

---

## Estrategia de detección de empresa y resiliencia al DOM

LinkedIn cambia el markup con frecuencia. La extensión debe **aislar selectores** y usar **varios fallbacks**.

### Principios

1. **Selectores centralizados** en `lib/selectors.js` (arrays ordenados por fiabilidad).
2. **Fallbacks en cascada**: probar selector A → B → C; si ninguno funciona, no romper la página (fallo silencioso + log opcional en desarrollo).
3. **Atributos semánticos primero**: enlaces a `/company/...`, `data-*` estables si existen, `aria-label` útiles.
4. **Heurísticas de último recurso**: texto visible del nombre de empresa cerca de la tarjeta (menos fiable).
5. **Idempotencia**: marcar nodos ya procesados (`data-ljf-processed`) para no duplicar botones ni reobservar en bucle.
6. **Re-escaneo** ante mutaciones y ante `chrome.storage.onChanged`.

### Qué extraer por tarjeta

- Contenedor de la tarjeta/oferta
- Nombre visible de la empresa
- URL o ID de empresa (preferido)
- Señal de «promocionado» / «Patrocinado» / sponsored (si aplica)
- Punto de anclaje en el DOM para insertar el botón

### MutationObserver

- Observar un contenedor raíz estable de la lista de empleos (con fallback a `document.body`).
- Filtrar mutaciones relevantes (`childList` / subárbol).
- Debounce corto (p. ej. 50–150 ms) para no procesar cada nodo por separado en scrolls densos.
- Desconectar/reconectar solo si el root desaparece (navegación SPA interna de LinkedIn).

### Señales de rotura (para testing / mantenimiento)

- Cero botones inyectados en una página de resultados con ofertas visibles
- Cero ocultaciones con lista negra no vacía
- Errores en consola del content script

Documentar en el código (comentarios breves) qué selector era el primario en la última verificación manual.

---

## UX

### Botón «Bloquear empresa»

- Texto corto: **Bloquear empresa** (o icono + tooltip en espacio reducido).
- Colocado junto al nombre de la empresa o en la zona de acciones de la tarjeta, sin tapar el título del puesto.
- Estado tras bloquear: la tarjeta se oculta/colapsa de inmediato; feedback mínimo (sin modales).
- No debe interferir con el clic nativo para abrir la oferta (usar `stopPropagation` solo en el botón).

### Comportamiento de tarjetas ocultas

| Modo | Comportamiento | Cuándo |
| --- | --- | --- |
| **Ocultar** (`remove`) | `display: none` o equivalente; la tarjeta no ocupa espacio | Default MVP |
| **Colapsar** (`collapse`) | Sustituir/plegar a una franja: «Oferta oculta (Empresa) — Mostrar» | Post-MVP / setting |

«Mostrar» en modo colapsar revela esa tarjeta en la sesión actual sin desbloquear la empresa (salvo que se ofrezca también «Desbloquear»).

### Ofertas promocionadas

- Si la empresa está bloqueada y `hidePromoted` es true, ocultar igual que una oferta orgánica.
- Dejar claro en popup/README: **esto no bloquea anuncios a nivel de red**; LinkedIn puede seguir cargándolos.

### Popup

- Lista de empresas bloqueadas (nombre + fecha).
- Acción **Desbloquear** por fila.
- Vacío: mensaje «No hay empresas bloqueadas».
- Accesos a importar/exportar (MVP tardío o post-MVP).
- Enlace corto a la explicación de privacidad / ads.

---

## Importar / exportar la lista negra

Formato propuesto: **JSON** versionado.

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-10-16T12:00:00.000Z",
  "blockedCompanies": [
    {
      "key": "company:12345678",
      "companyId": "12345678",
      "companyUrl": "https://www.linkedin.com/company/acme/",
      "displayName": "Acme Corp",
      "blockedAt": "2026-10-16T12:00:00.000Z"
    }
  ]
}
```

- **Exportar**: generar archivo `.json` descargable desde el popup/options.
- **Importar**: fusionar por `key` (no duplicar); opción «reemplazar todo» vs «fusionar».
- Validar esquema antes de escribir en storage; rechazar JSON inválido con mensaje claro.

---

## Permisos y privacidad

### Permisos Manifest V3 (MVP)

```json
{
  "permissions": ["storage"],
  "host_permissions": ["https://www.linkedin.com/*"]
}
```

- **`storage`**: guardar lista negra y preferencias.
- **Host solo LinkedIn**: content script únicamente en `linkedin.com`.
- Sin `tabs`, sin `webRequest`, sin acceso a otros sitios.
- Sin analytics de terceros, sin telemetría propia, sin backend.

### Principios de privacidad

- Todos los datos permanecen en el navegador del usuario.
- No se envían nombres de empresas, IDs ni historial a ningún servidor.
- El código debe ser auditable (JS legible, sin ofuscación en la Store).

---

## Desarrollo: carga unpacked

1. Clonar este repositorio.
2. Abrir Chrome en `chrome://extensions`.
3. Activar **Modo de desarrollador**.
4. **Cargar extensión sin empaquetar** y seleccionar la carpeta del proyecto (raíz con `manifest.json`).
5. Abrir LinkedIn Jobs (`/jobs/search`) y comprobar el botón y la ocultación.
6. Tras cada cambio en JS/CSS: recargar la extensión (icono de actualizar en `chrome://extensions`) y refrescar la pestaña de LinkedIn.

### Prueba local sin LinkedIn (fixture)

Sin cuenta de LinkedIn puedes validar la lógica de detección, botón, bloqueo, ocultación y `MutationObserver`:

1. Abre `test/fixture.html` directamente en Chrome (`Archivo → Abrir archivo…`, o arrastra el HTML a una pestaña).
2. Debe aparecer el botón **Bloquear empresa** en cada tarjeta simulada.
3. Al bloquear, las tarjetas de esa empresa se ocultan; **Añadir tarjeta** simula scroll infinito.
4. **Desbloquear todas** vacía la lista en memoria; **Ver storage** muestra el mapa actual en la barra de estado.

Checks de normalización de claves (Node):

```bash
node test/company.test.js
```

> El fixture usa un `chrome.storage` en memoria (fallback de `lib/storage.js`). En LinkedIn real se usa `chrome.storage.local` de la extensión cargada unpacked.

### Requisitos

- Google Chrome reciente (Manifest V3).
- Cuenta de LinkedIn para pruebas manuales en producción.
- Sin build step en MVP (JS/CSS planos). Opcional más adelante: bundler solo si se justifica.

---

## Plan de pruebas

### Pruebas manuales (MVP)

| Caso | Pasos | Resultado esperado |
| --- | --- | --- |
| Inyección del botón | Abrir `/jobs/search` con resultados | Cada tarjeta muestra «Bloquear empresa» |
| Bloquear | Clic en el botón | Empresa en storage; tarjeta oculta |
| Persistencia | Recargar la página | Ofertas de esa empresa siguen ocultas |
| Scroll infinito | Bajar hasta cargar más resultados | Nuevas tarjetas de la empresa también se ocultan; botones en las nuevas |
| Navegación SPA | Cambiar filtros / otra búsqueda y volver | Observer sigue activo; no hay botones duplicados |
| Desbloquear | Desde el popup, desbloquear | Tarjetas vuelven a mostrarse tras re-escaneo |
| Promocionadas | Oferta sponsored de empresa bloqueada | Oculta en cliente (si el DOM la identifica) |
| Sin romper LinkedIn | Interactuar con oferta, guardar, etc. | Flujos nativos siguen funcionando |

### Pruebas de regresión ante cambios de DOM

- Mantener una checklist de selectores y una captura/notas de la última fecha de verificación.
- Si LinkedIn rompe selectores: actualizar solo `lib/selectors.js` y re-probar la tabla anterior.

### Pruebas de storage / import-export

- Importar JSON válido (fusión y reemplazo).
- Rechazar JSON malformado.
- Exportar → reimportar en perfil limpio → misma lista.

### Automatización (opcional, más adelante)

- Tests unitarios de `company.js` (normalización de claves) y merge de import.
- Tests de selectores con fixtures HTML guardados (sin depender de LinkedIn en CI).

---

## Riesgos

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Cambios frecuentes del DOM de LinkedIn | Alto — deja de ocultar o de mostrar el botón | Selectores centralizados + fallbacks + checklist de regresión |
| Identificación solo por nombre | Medio — falsos positivos/negativos | Preferir ID/URL; nombre solo como fallback |
| Ofertas promocionadas con markup distinto | Medio — siguen visibles | Detectores específicos de sponsored + documentar límite |
| Expectativa de «bloquear ads de verdad» | Medio (confianza) | Copy claro en README, popup y ficha de la Store |
| Navegación SPA sin reload | Medio — observer huérfano | Re-anclar observer; escuchar cambios de URL si hace falta |
| Violación de términos de LinkedIn | Variable | Solo UI client-side; no automatizar acciones ni scrapear a escala |
| Cuotas de `storage.sync` si se adopta | Bajo | Empezar con `local`; sync opcional y acotado |
| Revisión Chrome Web Store | Medio | Permisos mínimos, política de privacidad clara, descripción honesta |

---

## Roadmap por fases

### Fase 0 — Planificación

- [x] Redactar plan del proyecto en `README.md`
- [ ] Acordar nombre público, iconos y tono de copy (ES)

### Fase 1 — Esqueleto MV3

- [x] Crear `manifest.json` (MV3, permisos mínimos)
- [x] Content script vacío + `styles.css` + popup mínimo
- [x] Iconos placeholder
- [ ] Carga unpacked y smoke test en LinkedIn *(requiere prueba manual con cuenta)*

### Fase 2 — Detección y botón

- [x] `lib/selectors.js` con selectores para `/jobs/search`
- [x] Extracción de empresa (ID/URL/nombre)
- [x] Inyección idempotente del botón «Bloquear empresa»
- [x] Escritura en `chrome.storage.local` al bloquear

### Fase 3 — Filtrado automático

- [x] Aplicar ocultación a tarjetas cuya empresa esté en la lista
- [x] `MutationObserver` con debounce para scroll infinito
- [x] Reaccionar a `storage.onChanged` (desbloqueo desde popup)
- [x] Manejo básico de ofertas promocionadas (client-side)

### Fase 4 — Popup de gestión

- [x] Listar empresas bloqueadas
- [x] Desbloquear una o varias
- [x] Estados vacíos y mensajes de privacidad / ads

### Fase 5 — Robustez y UX

- [x] Fallbacks de selectores y marcado `data-ljf-*` *(MVP básico; ampliar tras verifying en LinkedIn real)*
- [ ] Setting ocultar vs colapsar + «Mostrar»
- [ ] Cobertura `/jobs/collections` y panel de detalle
- [ ] Import / export JSON

### Fase 6 — Pulido y Store

- [ ] Options page (si aporta valor claro)
- [ ] Iconos finales, capturas, textos de la Store (ES)
- [ ] Política de privacidad (página o sección)
- [ ] Checklist de revisión MV3 / permisos
- [ ] Publicación en Chrome Web Store
- [ ] (Opcional) Cobertura experimental del feed

---

## Publicación en Chrome Web Store

Pasos resumidos cuando el MVP esté estable:

1. **Cuenta de desarrollador** en [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (pago único de registro).
2. **Empaquetar** el directorio de la extensión (ZIP con `manifest.json` en la raíz; sin `.git` ni archivos de desarrollo innecesarios).
3. **Ficha del producto**
   - Nombre, descripción corta y detallada (mencionar ocultación client-side de ads).
   - Capturas de pantalla (popup + botón en LinkedIn Jobs).
   - Icono 128×128 (y assets requeridos).
   - Categoría adecuada (Productividad / Flujo de trabajo).
4. **Privacidad**
   - Declarar que no se recopilan datos de usuario (o el uso exacto de `storage` local).
   - URL de política de privacidad si la Store la exige.
   - Justificar el host permission solo para `linkedin.com`.
5. **Cumplimiento**
   - Manifest V3 obligatorio.
   - Sin código ofuscado; sin permisos amplios injustificados.
   - Cumplir políticas de contenido y de productos de un solo propósito.
6. **Enviar a revisión** y responder a posibles rechazos (suele pedirse aclarar permisos o el alcance exacto).
7. **Versionado**: incrementar `version` en `manifest.json` en cada publicación; mantener changelog breve en el README o en notas de la Store.

---

## Decisiones de diseño abiertas

| Tema | Opciones | Inclinación actual |
| --- | --- | --- |
| Modo por defecto de ocultación | remove vs collapse | `remove` en MVP; collapse como setting |
| Sync entre dispositivos | solo `local` vs `sync` | `local` primero |
| Idioma de la UI | solo ES vs i18n | ES en MVP |
| Service worker | mínimo vs ninguno extra | Mínimo si MV3 lo requiere; lógica en content script |
| Nombre público | «LinkedIn Job Filter» vs marca propia | Por definir en Fase 0 |

---

## Licencia

Por definir (p. ej. MIT) antes de publicar en la Store o abrir el repo de forma pública con contribución externa.

---

## Resumen

Esta extensión da a la persona usuaria control local sobre qué empresas ve en LinkedIn Jobs: un botón por oferta, una lista negra en `chrome.storage`, y ocultación automática — también en contenido cargado al hacer scroll — sin backend y sin que ningún dato salga del navegador. El **MVP (fases 1–4)** está implementado; falta validación manual en LinkedIn real y el trabajo post-MVP (options, import/export, collapse, Store).
