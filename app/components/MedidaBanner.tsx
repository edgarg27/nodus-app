// Medida de los banners del carrusel (panel de cliente y del staff): se muestran a lo ancho con proporción 2.65 : 1
// (.cli-carrusel-img en globals.css). Si cambia esa proporción, cambiar también este texto.
export default function MedidaBanner() {
  return (
    <p style={{ fontSize: 12, color: "#555", margin: "0 0 6px", lineHeight: 1.5 }}>
      📐 <b>Medida: 1590 × 600 px</b> (proporción 2.65 : 1, horizontal), JPG o PNG de menos de 1 MB. Deja textos y logos
      hacia el centro: las esquinas van redondeadas y en celular se ve más chico. Si la imagen tiene otra proporción, se
      recorta para llenar el espacio.
    </p>
  );
}
