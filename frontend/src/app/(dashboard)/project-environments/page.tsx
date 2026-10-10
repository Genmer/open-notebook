import { redirect } from 'next/navigation'

// 旧路由 307（temporary）重定向到模块页项目环境 tab；
// 稳定一个版本后可升级 permanentRedirect（308）
export default function ProjectEnvironmentsPage() {
  redirect('/ruankao?tab=environments')
}
