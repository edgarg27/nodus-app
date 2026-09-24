import { paginaVista } from "../paginaVista";

export default async function Pagina() {
  return paginaVista("proveedores", ["admin", "superadmin", "gerente", "sistemas", "operaciones"]);
}
