"""Write a four-element ONNX Relu model without a Python ONNX dependency."""
from pathlib import Path


def integer(n):
    result = []
    while n >= 128:
        result.append((n & 127) | 128)
        n >>= 7
    return bytes(result + [n])


def field(number, value):
    if isinstance(value, int):
        return integer(number << 3) + integer(value)
    if isinstance(value, str):
        value = value.encode()
    return integer((number << 3) | 2) + integer(len(value)) + value


def value_info(name):
    shape = b''.join(field(1, field(1, n)) for n in [1, 1, 2, 2])
    return field(1, name) + field(2, field(1, field(1, 1) + field(2, shape)))

node = field(1, 'input') + field(2, 'output') + field(4, 'Relu')
graph = field(1, node) + field(2, 'relu-test') + field(11, value_info('input')) + field(12, value_info('output'))
Path(__file__).with_name('relu.onnx').write_bytes(field(1, 8) + field(7, graph) + field(8, field(2, 13)))

# Separate named outputs make ordering bugs visible in multi-input graph adapters.
addition = field(1, 'left') + field(1, 'right') + field(2, 'sum') + field(4, 'Add')
subtraction = field(1, 'left') + field(1, 'right') + field(2, 'difference') + field(4, 'Sub')
graph = field(1, addition) + field(1, subtraction) + field(2, 'arithmetic-test')
graph += field(11, value_info('left')) + field(11, value_info('right'))
graph += field(12, value_info('sum')) + field(12, value_info('difference'))
Path(__file__).with_name('arithmetic.onnx').write_bytes(field(1, 8) + field(7, graph) + field(8, field(2, 13)))
