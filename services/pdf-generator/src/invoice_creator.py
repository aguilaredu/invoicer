import json
import os
from dataclasses import asdict

import pandas as pd
from jinja2 import Template
from weasyprint import HTML

from models.invoice import Invoice
from utils import (
    generate_whatsapp_message,
    get_invoice_name,
    get_path,
    load_invoice_data,
)


class InvoiceCreator:
    def __init__(
        self,
        invoice_data_path,
        output_path,
        template_path,
        whatsapp_output_path,
        invoice_config,
        whatsapp_config,
    ):
        self.invoice_data_path = get_path(invoice_data_path)
        self.output_path = get_path(output_path)
        self.template_path = get_path(template_path)
        self.whatsapp_output_path = get_path(whatsapp_output_path)
        self.invoice_config = invoice_config
        self.whatsapp_config = whatsapp_config
        self.template_folder_path = os.path.dirname(self.template_path)
        self.invoice_data: pd.DataFrame = pd.DataFrame()
        self.template: Template | None = None
        self.invoices: list[Invoice] = []
        self.initialize()

    def initialize(self):
        print("Initializing invoice creation...")
        self.invoice_data = load_invoice_data(invoice_data_path=self.invoice_data_path)
        self.load_template()
        self._create_invoice_objects()

    def load_template(self):
        with open(self.template_path, encoding="utf-8") as f:
            template_str = f.read()
        self.template = Template(template_str)

    def _create_invoice_objects(self):
        print("Creating invoice objects...")
        for _, row in self.invoice_data.iterrows():
            send_receipt = (
                str(row.get("ocupa_recibo", "False")).strip().upper() == "TRUE"
            )

            pdf_filename = get_invoice_name(row)
            full_pdf_path = os.path.join(self.output_path, pdf_filename)

            message = generate_whatsapp_message(
                row, self.invoice_config, self.whatsapp_config
            )

            # Explicitly cast types to satisfy the linter
            name: str = str(row["nombre"])
            phone: str = str(row["telefono"])
            lot: str = str(row["lote"])
            invoice_number: str = str(row["numero_factura"])
            amount: float = float(row["cuota"])
            pending_amount: float = float(row["pendiente"])

            invoice = Invoice(
                filename=full_pdf_path,
                name=name,
                phone=phone,
                lot=lot,
                invoice_number=invoice_number,
                message=message,
                amount=amount,
                pending_amount=pending_amount,
                send_receipt=send_receipt,
                status="PENDING",
            )
            self.invoices.append(invoice)

    def _render_invoice(self, invoice: Invoice) -> str:
        assert self.template is not None
        rendered_html = self.template.render(
            lote=invoice.lot,
            nombre=invoice.name,
            dia_antes=self.invoice_config["pay_before_day"],
            dia=self.invoice_config["day_issued"],
            mes=self.invoice_config["month"],
            ano=self.invoice_config["year"],
            cuota=invoice.amount,
            numero_factura=invoice.invoice_number,
            telefono=invoice.phone,
        )
        return rendered_html

    def generate_invoices(self):
        print(f"Generating {len(self.invoices)} invoices...")
        for invoice in self.invoices:
            html_str = self._render_invoice(invoice)
            HTML(string=html_str, base_url=str(self.template_folder_path)).write_pdf(
                invoice.filename
            )
        print("All invoices generated successfully.")

    def generate_whatsapp_json(self):
        print(f"Generating WhatsApp JSON output at {self.whatsapp_output_path}...")
        output_list = []
        for invoice in self.invoices:
            invoice_dict = asdict(invoice)

            # Use the basename for the filename field in the JSON
            invoice_dict["filename"] = os.path.basename(invoice.filename)

            # Add the country code
            invoice_dict["countryCode"] = self.invoice_config.get("country_code", "")

            output_list.append(invoice_dict)

        with open(self.whatsapp_output_path, "w", encoding="utf-8") as f:
            json.dump(output_list, f, indent=2, ensure_ascii=False)

        print("WhatsApp JSON file generated successfully.")
