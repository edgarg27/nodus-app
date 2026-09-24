import { paginaVista } from "../paginaVista";

export default async function Pagina() {
  return paginaVista("visitas", ["admin", "superadmin", "gerente"]);
}
