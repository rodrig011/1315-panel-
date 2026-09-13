import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { ProductLayer } from "@/components/product/product-layer";

export function AppShell({children}:{children:React.ReactNode}){
  return <ProductLayer><div className="min-h-screen"><Sidebar/><div className="min-h-screen lg:pl-[248px]"><Header/><main className="mx-auto max-w-[1560px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</main></div></div></ProductLayer>
}
