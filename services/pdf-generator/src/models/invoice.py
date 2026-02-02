from dataclasses import dataclass


@dataclass
class Invoice:
    filename: str
    name: str
    phone: str
    lot: str
    invoice_number: str
    message: str
    amount: float
    pending_amount: float
    send_receipt: bool
    status: str
