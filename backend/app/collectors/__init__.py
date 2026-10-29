from app.collectors.easa import EasaCzibConnector
from app.collectors.feed import FeedConnector
from app.collectors.html_page import HtmlPageConnector
from app.collectors.ioda import IodaConnector

CONNECTORS = {"feed": FeedConnector, "html_page": HtmlPageConnector, "ioda": IodaConnector, "easa_czib": EasaCzibConnector}
