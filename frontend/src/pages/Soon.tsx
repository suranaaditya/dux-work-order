import { Card, PageHead } from "../components/ui";

export default function Soon({ title }: { title: string }) {
  return (
    <>
      <PageHead title={title} sub="Planned for a later slice of the SiteBill build." />
      <Card style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
        This screen isn’t built yet. Slice 1 covers Work Orders and RA Bills.
      </Card>
    </>
  );
}
