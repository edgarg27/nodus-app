// Ícono decorativo de capacidad de Sala de Juntas: dibuja una mesa
// (círculo vacío en medio) rodeada de un monito por persona, repartidos
// en círculo — igual que el ícono de referencia que mandó el usuario.
// La cantidad de monitos cambia según la capacidad de la sala elegida
// (extraída del texto libre de precios_cotizacion_sala_juntas.tamano,
// ej. "6 px" -> 6, "10 personas" -> 10), así que al cambiar el tamaño en
// el selector, los monitos aparecen o se quitan solos.

// Extrae el primer número que aparezca en el texto de "tamano" — no
// asume que siempre diga "personas": en este proyecto algunos centros lo
// capturaron como "6 px" en vez de "6 personas".
export function extraerCapacidadSala(tamano: string | null | undefined): number {
  if (!tamano) return 0;
  const match = tamano.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

type Props = {
  cantidad: number;
  size?: number;
};

const MAX_MONITOS = 20; // tope de seguridad por si algún "tamano" trae un número gigante por error de captura

export default function CapacidadSalaIcono({ cantidad, size = 120 }: Props) {
  const total = Math.max(0, Math.min(Math.round(cantidad), MAX_MONITOS));
  if (total <= 0) return null;

  const radioMonitos = size / 2 - 12;
  const posiciones = Array.from({ length: total }, (_, i) => {
    // -90° para que el primer monito quede arriba (como en la referencia)
    const angulo = (360 / total) * i - 90;
    const rad = (angulo * Math.PI) / 180;
    return {
      x: size / 2 + radioMonitos * Math.cos(rad),
      y: size / 2 + radioMonitos * Math.sin(rad),
    };
  });

  return (
    <div
      role="img"
      aria-label={`Capacidad: ${total} persona${total === 1 ? "" : "s"}`}
      style={{ position: "relative", width: size, height: size, margin: "10px auto 4px" }}
    >
      {/* Mesa */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: size * 0.42,
          height: size * 0.42,
          borderRadius: "50%",
          border: "2px solid #e2c4b3",
          background: "rgba(240, 126, 58, 0.05)",
        }}
      />
      {posiciones.map((p, i) => (
        <svg
          key={i}
          className="capacidad-sala-persona"
          viewBox="0 0 24 24"
          width={20}
          height={20}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            position: "absolute",
            left: p.x - 10,
            top: p.y - 10,
          }}
        >
          <circle cx="12" cy="7.5" r="3.5" />
          <path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" />
        </svg>
      ))}
    </div>
  );
}
