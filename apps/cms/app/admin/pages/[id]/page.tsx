import type { Id } from "@rm/convex/values";
import { PageEditor } from "./PageEditor";

/**
 * Block-stack editor route. Gated by the /admin layout (Clerk +
 * @radiomilwaukee.org). The page id comes from the URL; the editor loads it via
 * the auth-gated getPageForEdit query.
 */
export default async function EditPageRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageEditor pageId={id as Id<"pages">} />
    </main>
  );
}
