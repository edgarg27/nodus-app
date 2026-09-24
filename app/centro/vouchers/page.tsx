import { paginaVista } from "../paginaVista";

export default async function Pagina() {
  return paginaVista("vouchers", ["admin", "superadmin", "gerente", "sistemas"]);
}
