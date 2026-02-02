import yaml

from invoice_creator import InvoiceCreator


def main():
    config = load_config()  # Load configuration from YAML file

    # Generate invoices
    invoice_creator = InvoiceCreator(
        invoice_data_path=config["paths"]["input_list"],
        output_path=config["paths"]["output_folder"],
        template_path=config["paths"]["template_path"],
        whatsapp_output_path=config["paths"]["whatsapp_output_file"],
        invoice_config=config["invoice"],
        whatsapp_config=config["whatsapp"],
    )

    invoice_creator.generate_invoices()
    invoice_creator.generate_whatsapp_json()
    print("Process completed.")


def load_config(path="config.yaml", print_settings=True):
    print("Loading configuration...")
    with open(path, "r") as f:
        data = yaml.safe_load(f)
    return data


if __name__ == "__main__":
    main()
