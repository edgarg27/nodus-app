"use client";

import { useEffect, useRef, useState } from "react";

type FileDropzoneProps = {
  files: File[];
  onChange: (files: File[]) => void;
  maxFiles?: number;
  accept?: string;
  maxSizeMB?: number;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Zona de carga estilo "arrastra y suelta" para adjuntar fotos/PDFs a un
// reporte de soporte. Reemplaza el <input type="file"> nativo por algo
// más presentable, con miniaturas y límite de archivos configurable.
export default function FileDropzone({
  files,
  onChange,
  maxFiles = 5,
  accept = "image/*,.pdf",
  maxSizeMB = 8,
}: FileDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const [aviso, setAviso] = useState("");
  const [previews, setPreviews] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Genera previews solo para imágenes y libera los object URLs cuando
  // cambian los archivos, para no ir acumulando memoria.
  useEffect(() => {
    const urls = files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : ""));
    setPreviews(urls);
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  function agregarArchivos(lista: FileList | File[]) {
    setAviso("");
    const nuevos = Array.from(lista);
    const disponibles = maxFiles - files.length;

    if (disponibles <= 0) {
      setAviso(`Ya alcanzaste el máximo de ${maxFiles} archivos`);
      return;
    }

    const aceptados: File[] = [];
    let huboMuyPesado = false;
    for (const f of nuevos) {
      if (aceptados.length >= disponibles) break;
      if (f.size > maxSizeMB * 1024 * 1024) {
        huboMuyPesado = true;
        continue;
      }
      aceptados.push(f);
    }

    if (huboMuyPesado) setAviso(`Algún archivo pesa más de ${maxSizeMB}MB y no se agregó`);
    else if (nuevos.length > disponibles) setAviso(`Solo puedes subir hasta ${maxFiles} archivos`);

    if (aceptados.length > 0) onChange([...files, ...aceptados]);
  }

  function quitarArchivo(index: number) {
    setAviso("");
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div>
      <div
        className={"dropzone" + (dragActive ? " drag-active" : "")}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files?.length) agregarArchivos(e.dataTransfer.files);
        }}
      >
        <svg
          className="dropzone-icon"
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 15V3" />
          <path d="M7 8l5-5 5 5" />
          <path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3" />
        </svg>
        <p className="dropzone-text">
          <span>Arrastra tus archivos aquí</span> o haz clic para elegirlos
        </p>
        <p className="dropzone-sub">
          {accept.includes("pdf") ? "Fotos o PDF" : "Fotos"} · hasta {maxSizeMB}MB c/u · máximo {maxFiles}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className="dropzone-input"
          onChange={(e) => {
            if (e.target.files?.length) agregarArchivos(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {aviso && <p className="dropzone-aviso">{aviso}</p>}

      {files.length > 0 && (
        <div className="dropzone-grid">
          {files.map((f, i) => (
            <div className="dropzone-item" key={`${f.name}-${f.lastModified}-${i}`}>
              {previews[i] ? (
                <img src={previews[i]} alt={f.name} className="dropzone-item-img" />
              ) : (
                <div className="dropzone-item-file">
                  <span className="dropzone-item-file-icon">📄</span>
                  <span className="dropzone-item-file-name">{f.name}</span>
                </div>
              )}
              <p className="dropzone-item-size">{formatBytes(f.size)}</p>
              <button
                type="button"
                className="dropzone-remove"
                onClick={() => quitarArchivo(i)}
                aria-label={`Quitar ${f.name}`}
              >
                ✕
              </button>
            </div>
          ))}
          {files.length < maxFiles && (
            <button type="button" className="dropzone-add-tile" onClick={() => inputRef.current?.click()}>
              <span style={{ fontSize: 20, lineHeight: 1 }}>+</span>
              <span style={{ fontSize: 11 }}>Agregar</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
