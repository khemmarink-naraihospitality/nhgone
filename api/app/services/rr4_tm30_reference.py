# Nationality lookup tables backing the RR4 (ร.ร.๔ hotel guest register) and
# TM30 (foreign-national arrival notification) exports.
#
# Both government forms need a nationality CODE, but the Connector API only
# gives Customer.NationalityCode as an ISO 3166-1 alpha-2 string. Neither
# form's code scheme is alpha-2, so these dicts translate alpha-2 -> the
# form's own code.
#
# Reconciled from the real "RR4-TM30-Chinatown-Gen" Google Sheet Chinatown's
# front desk already uses (2 tabs: RR4-Nationality, 259 rows; TM30-
# Nationality, 268 rows) against this codebase's existing alpha-2 -> English
# name map (_RR3_COUNTRY_MAP in sync_service.py), matching by normalized
# country name. Not every alpha-2 code resolved automatically - the source
# sheet is hand-maintained and has real gaps/typos (e.g. Greece's own row
# actually contains Greenland's data; North Korea's row is mislabeled
# "Korea (Republic of)", identical to South Korea's) - those handful of
# entries are corrected/added by hand below with their evidence.
#
# Coverage: RR4 192/247, TM30 214/247 of the alpha-2 codes in
# _RR3_COUNTRY_MAP - every currency this properties' guest demographics
# realistically include (spot-checked against 40 major countries with zero
# further mismatches). The gaps are almost entirely uninhabited/tiny
# territories (Bouvet Island, Pitcairn, Svalbard, ...) that are not
# realistic guest nationalities. A code that isn't in these dicts renders as
# blank on the export rather than blocking the row - the same graceful
# degradation the source spreadsheet's own iferror(...,"Not found") uses.

# RR4-Nationality: alpha-2 -> Thai Hotel Act numeric nationality code.
RR4_NATIONALITY_CODE = {
    "AD": "120", "AE": "77", "AF": "100", "AG": "172", "AL": "119", "AM": "224",
    "AO": "128", "AR": "33", "AT": "11", "AU": "79", "AZ": "225", "BA": "234",
    "BB": "174", "BD": "64", "BE": "14", "BF": "131", "BG": "26", "BH": "101",
    "BI": "132", "BJ": "129", "BN": "69", "BO": "190", "BR": "34", "BS": "173",
    "BT": "102", "BW": "130", "BY": "233", "BZ": "175", "CA": "30", "CD": "138",
    "CF": "135", "CG": "138", "CH": "8", "CK": "246", "CL": "35", "CM": "133",
    "CN": "44", "CO": "37", "CR": "176", "CU": "32", "CV": "270", "CY": "28",
    "CZ": "18", "DE": "4", "DJ": "140", "DK": "6", "DO": "177", "DZ": "127",
    "EC": "191", "EE": "236", "EG": "74", "ER": "243", "ES": "15", "ET": "75",
    "FI": "13", "FJ": "111", "FM": "231", "FR": "5", "GA": "142", "GB": "126",
    "GD": "180", "GE": "226", "GH": "144", "GM": "143", "GN": "78", "GQ": "141",
    "GR": "20", "GT": "181", "GW": "145", "GY": "192", "HK": "44", "HN": "183",
    "HR": "221", "HT": "182", "HU": "19", "ID": "51", "IE": "12", "IL": "60",
    "IN": "45", "IO": "126", "IQ": "67", "IR": "62", "IS": "122", "IT": "9",
    "JM": "184", "JO": "103", "JP": "47", "KE": "73", "KG": "227", "KH": "57",
    "KI": "112", "KM": "137", "KN": "186",
    "KP": "104",  # own row confirmed ("เกาหลีเหนือ"/"THE DEMOCRATIC OF KOREA")
    "KR": "53", "KW": "68", "KZ": "223", "LA": "56", "LB": "61", "LC": "187",
    "LI": "123", "LK": "58", "LR": "147", "LS": "146", "LT": "238", "LU": "22",
    "LV": "237", "LY": "148", "MA": "154", "MC": "124", "MD": "240", "ME": "268",
    "MG": "149", "MH": "230", "MK": "239", "ML": "151",
    "MM": "48", "MN": "106",
    "MR": "152",  # "มอริเตเนีย"/"MAURITANTA" [sic]
    "MT": "24", "MU": "153", "MV": "105", "MW": "150", "MX": "31", "MY": "50",
    "MZ": "155", "NA": "244", "NE": "156", "NG": "76", "NI": "185", "NL": "3",
    "NO": "10", "NP": "55", "NR": "113", "NZ": "80", "OM": "107", "PA": "40",
    "PE": "39", "PG": "81", "PH": "49", "PK": "52", "PL": "17", "PS": "260",
    "PT": "2", "PW": "232", "PY": "193", "QA": "108", "RO": "27", "RS": "263",
    "RU": "16", "RW": "157", "SA": "59", "SB": "114", "SC": "160", "SD": "163",
    "SE": "7", "SG": "54", "SI": "242", "SK": "241", "SL": "161", "SM": "125",
    "SN": "159", "SO": "162", "SR": "194", "SS": "272", "SV": "179", "SY": "66",
    "TD": "136", "TG": "166", "TH": "99", "TJ": "228", "TL": "261", "TM": "235",
    "TN": "167", "TO": "115", "TR": "63", "TT": "189", "TV": "116", "TW": "220",
    "TZ": "165", "UA": "216", "UG": "168", "US": "29", "UY": "41", "UZ": "229",
    "VE": "42", "VN": "46", "VU": "117", "YE": "109", "ZA": "70", "ZM": "170",
    "ZW": "171",
}

# TM30-Nationality: alpha-2 -> ISO 3166-1 alpha-3 (as prescribed by the form).
TM30_NATIONALITY_CODE = {
    "AD": "AND", "AE": "ARE", "AF": "AFG", "AG": "ATG", "AI": "AIA", "AL": "ALB",
    "AM": "ARM", "AO": "AGO", "AR": "ARG", "AT": "AUT", "AU": "AUS", "AW": "AWB",
    "AZ": "AZE", "BA": "BIH", "BB": "BRB", "BD": "BGD", "BE": "BEL",
    "BF": "BFA",  # "BURKINAH FASO" [sic]
    "BG": "BGR", "BH": "BHR", "BI": "BDI", "BJ": "BEN", "BM": "BMU", "BN": "BRN",
    "BO": "BOL", "BR": "BRA", "BS": "BHS", "BT": "BTN", "BV": "BVT", "BW": "BWA",
    "BY": "BLR", "BZ": "BLZ", "CA": "CAN", "CC": "CCK", "CD": "COG", "CG": "COG",
    "CH": "CHE",
    "CI": "CIV",  # "Republic of Cote d'Ivoire" (curly apostrophe, missed by name-normalization)
    "CK": "COK", "CL": "CHL", "CM": "CMR", "CN": "CHN", "CO": "COL", "CR": "CRI",
    "CU": "CUB", "CV": "CPV", "CX": "CXR", "CY": "CYP", "CZ": "CZE", "DE": "DEU",
    "DJ": "DJI", "DK": "DNK", "DM": "DMA", "DO": "DOM", "DZ": "DZA", "EC": "ECU",
    "EE": "EST", "EG": "EGY", "ER": "ERI", "ES": "ESP", "ET": "ETH", "FI": "FIN",
    "FJ": "FJI", "FM": "FSM", "FR": "FRA", "GA": "GAB", "GB": "GBR", "GD": "GRD",
    "GE": "GEO", "GF": "GUF", "GH": "GHA", "GI": "GIB",
    "GM": "GMB",  # "THE ISLAM REPUBLIC OF THE GAMBIA" [sic]
    "GN": "GIN", "GP": "GLP", "GQ": "GNQ",
    "GR": "GRC",  # corrected: the sheet's "Greece"-labeled row actually contains Greenland's data (GRL) - see module docstring
    "GT": "GTM", "GU": "GUM", "GW": "GNB", "GY": "GUY", "HK": "HKG", "HN": "HND",
    "HR": "HRV", "HT": "HTI", "HU": "HUN", "ID": "IDN", "IE": "IRL", "IL": "ISR",
    "IN": "IND", "IQ": "IRQ", "IR": "IRN", "IS": "ISL", "IT": "ITA", "JM": "JAM",
    "JO": "JOR", "JP": "JPN", "KE": "KEN", "KH": "KHM", "KI": "KIR",
    "KM": "COM",  # "THE ISIAMIC FEDERAL REPUBLIC OF THE COMOROS" [sic]
    "KP": "PRK",  # blank Mews-Nationality cell on its row; code confirmed directly
    "KR": "KOR", "KW": "KWT", "KY": "CYM", "KZ": "KAZ", "LA": "LAO", "LB": "LBN",
    "LC": "LCA", "LI": "LIE", "LK": "LKA", "LR": "LBR", "LS": "LSO", "LT": "LTU",
    "LU": "LUX", "LV": "LVA", "LY": "LBY", "MA": "MAR", "MC": "MCO", "MD": "MDA",
    "ME": "MNE", "MG": "MDG", "MH": "MHL", "MK": "MKD", "ML": "MLI", "MM": "MMR",
    "MN": "MNG", "MO": "MAC", "MQ": "MTQ", "MR": "MRT", "MS": "MSR", "MT": "MLT",
    "MU": "MUS", "MV": "MDV", "MW": "MWI", "MX": "MEX", "MY": "MYS", "MZ": "MOZ",
    "NA": "NAM", "NE": "NER", "NF": "NFK", "NG": "NGA", "NI": "NIC", "NL": "NLD",
    "NO": "NOR", "NP": "NPL", "NR": "NRU", "NU": "NIU", "NZ": "NZL", "OM": "OMN",
    "PA": "PAN", "PE": "PER", "PF": "PYF", "PG": "PNG", "PH": "PHL", "PK": "PAK",
    "PL": "POL", "PN": "PCN", "PS": "PLT", "PT": "PRT", "PW": "PLW", "PY": "PRY",
    "QA": "QAT", "RO": "ROU", "RS": "SRB", "RU": "RUS", "SA": "SAU", "SB": "SLB",
    "SC": "SYC", "SD": "SDN", "SE": "SWE", "SG": "SGP", "SI": "SVN", "SK": "SVK",
    "SL": "SLE", "SM": "SMR", "SN": "SEN", "SO": "SOM", "SR": "SUR",
    "SS": "SSD",  # "REPUBLIC OF SOUTH SUDAN"
    "SV": "SLV", "SY": "SYR", "SZ": "SWZ", "TC": "TCA", "TD": "TCD", "TG": "TGO",
    "TH": "THA", "TJ": "TJK", "TK": "TKL", "TL": "TLS", "TM": "TKM", "TN": "TUN",
    "TO": "TON", "TR": "TUR", "TT": "TTO", "TV": "TUV", "TW": "TWN", "TZ": "TZA",
    "UA": "UKR", "UG": "UGA", "UM": "UMI", "US": "USA", "UY": "URY", "UZ": "UZB",
    "VC": "VCT", "VE": "VEN", "VN": "VNM", "VU": "VUT", "WS": "WSM", "YE": "YEM",
    "YT": "MYT", "ZA": "ZAF", "ZM": "ZMB", "ZW": "ZIM",
}
