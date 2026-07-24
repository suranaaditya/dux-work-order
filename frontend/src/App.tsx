import { Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/Shell";
import { CompanyProvider } from "./lib/company";
import Dashboard from "./pages/Dashboard";
import WorkOrders from "./pages/WorkOrders";
import WorkOrderDetail from "./pages/WorkOrderDetail";
import NewWorkOrder from "./pages/NewWorkOrder";
import RABills from "./pages/RABills";
import RABillDetail from "./pages/RABillDetail";
import NewRABill from "./pages/NewRABill";
import Suppliers from "./pages/Suppliers";
import SupplierDetail from "./pages/SupplierDetail";
import RecordInvoice from "./pages/RecordInvoice";
import Invoices from "./pages/Invoices";
import InvoiceDetail from "./pages/InvoiceDetail";
import RecordPayment from "./pages/RecordPayment";
import Payments from "./pages/Payments";
import PaymentDetail from "./pages/PaymentDetail";
import Reports from "./pages/Reports";
import Soon from "./pages/Soon";

export default function App() {
  return (
    <CompanyProvider>
      <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/work-orders" element={<WorkOrders />} />
        <Route path="/work-orders/new" element={<NewWorkOrder />} />
        <Route path="/work-orders/:name" element={<WorkOrderDetail />} />
        <Route path="/ra-bills" element={<RABills />} />
        <Route path="/ra-bills/new" element={<NewRABill />} />
        <Route path="/ra-bills/:name/record-invoice" element={<RecordInvoice />} />
        <Route path="/ra-bills/:name" element={<RABillDetail />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/:name/pay" element={<RecordPayment />} />
        <Route path="/invoices/:name" element={<InvoiceDetail />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/payments/:name" element={<PaymentDetail />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/suppliers/:name" element={<SupplierDetail />} />
        <Route path="/measurement-book" element={<Soon title="Measurement Book" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Shell>
    </CompanyProvider>
  );
}
