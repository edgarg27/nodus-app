"use client";

import { useId } from "react";
import type { CSSProperties, ReactNode } from "react";

// Checkbox con tache animado (ver estilos ".checkbox-wrapper" en
// app/globals.css). El SVG usa el atributo "pathLength" en vez de
// coordenadas que calcen a mano con el stroke-dasharray del CSS —
// pathLength le dice al navegador "trata este trazo como si midiera
// exactamente N unidades", así que aunque el dibujo del cuadro y del
// palomita sean simples, el dasharray/dashoffset del CSS (800 y 172)
// funciona igual sin tener que medir el trazo real.
type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode; // texto de la etiqueta (opcional, para casos sin texto visible)
  disabled?: boolean;
  name?: string;
  style?: CSSProperties; // estilo del contenedor — para casos que ya traían fontWeight/color/margin propios en su <label>
  className?: string; // para casos que ya traían una clase propia en su <label> (ej. "warning-check-row"), se agrega junto a "checkbox-wrapper"
};

export default function Checkbox({ checked, onChange, children, disabled, name, style, className }: CheckboxProps) {
  const id = useId();
  return (
    <div className={className ? `checkbox-wrapper ${className}` : "checkbox-wrapper"} style={style}>
      <input
        type="checkbox"
        id={id}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label className="terms-label" htmlFor={id}>
        <svg className="checkbox-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect className="checkbox-box" x="2" y="2" width="20" height="20" rx="5" strokeWidth="2" pathLength={800} />
          <path
            className="checkbox-tick"
            d="M6.5 12.5L10.2 16.2L17.5 8"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={172}
          />
        </svg>
        {children != null && children !== "" && <span className="label-text">{children}</span>}
      </label>
    </div>
  );
}
