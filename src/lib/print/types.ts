export type PaperSize = "80mm" | "58mm";

export type ReceiptItem = {
  id?: string;
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
  notes?: string | null;
  addons?: { name: string; price: number }[];
};

export type ReceiptTaxLine = {
  name: string;
  rate: number;
  amount: number;
};

export type ReceiptPayment = {
  method: string;
  amount: number;
  kind?: string | null;
  reference?: string | null;
};

export type ReceiptData = {
  // Header
  brandName: string;
  legalName?: string | null;
  address?: string | null;
  phone?: string | null;
  taxId?: string | null;
  logoUrl?: string | null;

  // Order
  orderNo: string;
  orderId: string;
  diningType: "dine_in" | "takeaway" | "delivery";
  tableLabel?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  orderNotes?: string | null;
  cashierName?: string | null;
  createdAt: string;

  // Money
  currencySymbol: string;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  taxes: ReceiptTaxLine[];
  deliveryFee?: number;
  serviceCharge?: number;
  grandTotal: number;
  paymentStatus?: "pending" | "partial" | "paid" | "refunded";
  payments: ReceiptPayment[];
  amountReceived?: number;
  changeReturned?: number;

  // Footer
  footerNote?: string;
};

export type PrintJob = {
  kind: "receipt" | "kot";
  paperSize: PaperSize;
  html: string;
  copies?: number;
};

export interface PrinterDriver {
  id: string;
  label: string;
  isAvailable(): Promise<boolean>;
  print(job: PrintJob): Promise<void>;
}
