import pandas as pd

columns = [
    "Number", "Group name", "Last name", "First name", "Email", "Telephone", 
    "Address", "Customer nationality", "Send marketing emails", "Booker", 
    "Status", "Creator", "Created", "Release", "Confirmed", "Canceled", 
    "Arrival", "Departure", "Count (nights)", "Person count", "Count (bed, nightly)", 
    "Requested category", "Space category", "Space number", "Origin", 
    "Channel manager ID", "Group channel manager ID", "Group channel confirmation number", 
    "Travel agency confirmation number", "Segment", "Rate", "Voucher", "Products", 
    "Company", "Travel agency", "Average rate (nightly)", "Total amount", "Canceled cost", 
    "Commission", "Customer cost", "Balance of companions", "Payment card type", 
    "Payment card number", "Expiration", "Automatic payment", "Bills", 
    "Cancellation reason", "Notes", "Customer notes", "Customer classifications", 
    "Pricing classification", "Booking purpose", "Reservation source", "Identifier", 
    "Company Identifier", "Travel agency Identifier", "Reservation origin details", 
    "Restoration reason"
]

df = pd.DataFrame({"Column Name": columns})
df.to_excel("Reservation_Aligned_Fields.xlsx", index=False)
print("Excel file created successfully.")
