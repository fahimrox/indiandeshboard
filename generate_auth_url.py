from fyers_apiv3 import fyersModel

client_id = "GHIT2K4T2R-100"
secret_key = "VEQNLGHWP1"
redirect_uri = "https://www.google.com"

session = fyersModel.SessionModel(
    client_id=client_id,
    secret_key=secret_key,
    redirect_uri=redirect_uri,
    response_type="code",
    grant_type="authorization_code"
)

print(session.generate_authcode())